/**
 * Fonte de dados de composição/exposição: Yahoo Finance quoteSummary
 * (módulos assetProfile, summaryProfile, fundProfile, topHoldings,
 * summaryDetail, defaultKeyStatistics).
 *
 * Dados estruturados de uma API financeira real. Nunca LLM.
 * Quando um campo não vem da fonte, fica null.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let session: { cookie: string; crumb: string; at: number } | null = null;

async function getSession(): Promise<{ cookie: string; crumb: string } | null> {
  if (session && Date.now() - session.at < 30 * 60 * 1000) return session;
  try {
    const res = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
    const raw =
      // Cloudflare/undici expõem getSetCookie() quando há vários cabeçalhos
      (typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie ===
      "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie().join(", ")
        : res.headers.get("set-cookie")) ?? "";
    const cookie = raw
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0]?.trim())
      .filter((c): c is string => !!c && c.includes("="))
      .join("; ");
    if (!cookie) return null;
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes("<")) return null;
    session = { cookie, crumb, at: Date.now() };
    return session;
  } catch {
    return null;
  }
}

type Num = { raw?: number } | number | null | undefined;
const n = (v: Num): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object" && typeof v.raw === "number") return v.raw;
  return null;
};

export interface QuoteSummary {
  assetProfile?: {
    country?: string;
    sector?: string;
    industry?: string;
    longBusinessSummary?: string;
  };
  summaryProfile?: { country?: string; sector?: string; industry?: string };
  fundProfile?: {
    family?: string;
    categoryName?: string;
    legalType?: string;
    feesExpensesInvestment?: Record<string, Num>;
  };
  topHoldings?: {
    holdings?: Array<{ symbol?: string; holdingName?: string; holdingPercent?: Num }>;
    sectorWeightings?: Array<Record<string, Num>>;
    stockPosition?: Num;
    bondPosition?: Num;
  };
  summaryDetail?: { yield?: Num; currency?: string; trailingAnnualDividendYield?: Num };
  price?: { longName?: string; shortName?: string; currency?: string; quoteType?: string };
  defaultKeyStatistics?: { yield?: Num; totalAssets?: Num };
}

export async function fetchQuoteSummary(symbol: string): Promise<QuoteSummary | null> {
  const s = await getSession();
  if (!s) return null;
  const modules =
    "assetProfile,summaryProfile,fundProfile,topHoldings,summaryDetail,price,defaultKeyStatistics";
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
    symbol,
  )}?modules=${modules}&crumb=${encodeURIComponent(s.crumb)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Cookie: s.cookie, Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
      session = null;
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json()) as { quoteSummary?: { result?: QuoteSummary[] } };
    return json.quoteSummary?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

export interface FundData {
  name: string | null;
  quoteType: string | null;
  currency: string | null;
  category: string | null;
  family: string | null;
  legalType: string | null;
  dividendYield: number | null;
  country: string | null;
  sector: string | null;
  industry: string | null;
  holdings: Array<{ symbol: string | null; name: string; weight: number }>;
  sectorWeights: Array<{ sector: string; weight: number }>;
}

export function parseQuoteSummary(qs: QuoteSummary): FundData {
  const profile = qs.assetProfile ?? qs.summaryProfile ?? {};
  const holdings = (qs.topHoldings?.holdings ?? [])
    .map((h) => ({
      symbol: h.symbol?.trim() || null,
      name: (h.holdingName || h.symbol || "").trim(),
      weight: n(h.holdingPercent) ?? 0,
    }))
    .filter((h) => h.name && h.weight > 0);
  const sectorWeights = (qs.topHoldings?.sectorWeightings ?? [])
    .flatMap((entry) =>
      Object.entries(entry).map(([sector, w]) => ({ sector, weight: n(w as Num) ?? 0 })),
    )
    .filter((s) => s.weight > 0);
  const y =
    n(qs.summaryDetail?.yield) ??
    n(qs.defaultKeyStatistics?.yield) ??
    n(qs.summaryDetail?.trailingAnnualDividendYield);
  return {
    name: qs.price?.longName || qs.price?.shortName || null,
    quoteType: qs.price?.quoteType ?? null,
    currency:
      qs.price?.currency?.toUpperCase() ?? qs.summaryDetail?.currency?.toUpperCase() ?? null,
    category: qs.fundProfile?.categoryName ?? null,
    family: qs.fundProfile?.family ?? null,
    legalType: qs.fundProfile?.legalType ?? null,
    dividendYield: y != null ? y * 100 : null,
    country: profile.country ?? null,
    sector: profile.sector ?? null,
    industry: profile.industry ?? null,
    holdings,
    sectorWeights,
  };
}
