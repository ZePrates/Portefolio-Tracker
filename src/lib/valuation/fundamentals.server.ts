/**
 * Recolha dos dados públicos de uma empresa para a avaliação:
 * - Yahoo Finance: cotação, perfil, consenso, insiders, demonstrações anuais
 *   (fundamentals-timeseries), histórico de preços, notícias e pares;
 * - BCE: curva AAA da zona euro a 10 anos (taxa sem risco em EUR);
 * - Finnhub (opcional, com FINNHUB_API_KEY): pares da mesma sub-indústria.
 *
 * O quoteSummary do Yahoo exige um "crumb" ligado a um cookie: obtém-se uma
 * vez por instância e renova-se quando o Yahoo responde 401.
 */

import { finnhubKey, FINNHUB_API } from "@/lib/finnhub";
import { formatNumber } from "@/lib/format";
import { fetchWithTimeout, mapWithConcurrency } from "@/lib/http";
import { parseYahooHistory, type YahooChartJson } from "@/lib/yahoo";
import type { CompanyData, MacroSnapshot, NewsItem, PeerMultiples } from "@/lib/valuation/types";
import {
  buildAnalysts,
  buildEarnings,
  buildInsiders,
  buildMarket,
  buildProfile,
  buildStatements,
  buildTrailing,
  parseEcbCsv,
  parseSearchNews,
  parseSearchQuotes,
  parseTimeseries,
  peerFromSummary,
  summaryBasics,
  summaryResult,
  TIMESERIES_KEYS,
  TRAILING_KEYS,
  type ParsedTimeseries,
  type SymbolHit,
} from "@/lib/valuation/yahoo-parse";

type Json = Record<string, unknown>;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/* ------------------------------------------------------------------ */
/* Sessão do Yahoo (cookie + crumb)                                     */
/* ------------------------------------------------------------------ */

let session: { cookie: string; crumb: string; at: number } | null = null;
const SESSION_TTL_MS = 6 * 3600_000;

async function yahooSession(force = false): Promise<{ cookie: string; crumb: string }> {
  if (!force && session && Date.now() - session.at < SESSION_TTL_MS) return session;
  const res = await fetchWithTimeout(
    "https://fc.yahoo.com/",
    { headers: { "User-Agent": UA }, redirect: "manual" },
    { retries: 1 },
  );
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const cookie = setCookies
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
  const cr = await fetchWithTimeout("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  const crumb = (await cr.text()).trim();
  if (!cr.ok || !crumb || crumb.length > 40 || crumb.includes("<")) {
    throw new Error("O Yahoo Finance recusou o pedido. Tenta daqui a pouco.");
  }
  session = { cookie, crumb, at: Date.now() };
  return session;
}

const SUMMARY_MODULES = [
  "price",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "assetProfile",
  "earningsTrend",
  "earningsHistory",
  "recommendationTrend",
  "insiderTransactions",
  "netSharePurchaseActivity",
  "calendarEvents",
];

const PEER_MODULES = [
  "price",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "assetProfile",
];

export async function quoteSummary(symbol: string, modules: string[]): Promise<Json | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await yahooSession(attempt > 0);
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      symbol,
    )}?modules=${modules.join(",")}&crumb=${encodeURIComponent(s.crumb)}`;
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": UA, Cookie: s.cookie, Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
      session = null;
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`O Yahoo Finance respondeu ${res.status}.`);
    return summaryResult(await res.json());
  }
  return null;
}

async function timeseries(symbol: string): Promise<ParsedTimeseries | null> {
  const types = [
    ...TIMESERIES_KEYS.map((k) => `annual${k}`),
    ...TRAILING_KEYS.map((k) => `trailing${k}`),
  ].join(",");
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - 7 * 365 * 86400;
  const sym = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${sym}?symbol=${sym}&type=${types}&period1=${p1}&period2=${p2}`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) return null;
  return parseTimeseries(await res.json());
}

async function priceHistory(symbol: string): Promise<{ date: string; close: number }[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) return [];
  const h = parseYahooHistory((await res.json()) as YahooChartJson);
  return h ? h.points.map((p) => ({ date: p.date, close: p.value * h.factor })) : [];
}

async function chartPrice(symbol: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
  };
  const p = json.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof p === "number" && Number.isFinite(p) && p > 0 ? p : null;
}

async function fxRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1;
  return chartPrice(`${from}${to}=X`);
}

async function searchYahoo(q: string, quotes: number, news: number): Promise<unknown> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${quotes}&newsCount=${news}&enableFuzzyQuery=false`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Pesquisa do Yahoo: ${res.status}`);
  return res.json();
}

export async function searchSymbols(q: string): Promise<SymbolHit[]> {
  return parseSearchQuotes(await searchYahoo(q, 8, 0));
}

async function newsFor(symbol: string): Promise<NewsItem[]> {
  return parseSearchNews(await searchYahoo(symbol, 0, 8)).slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Macro (em cache durante 1 hora)                                      */
/* ------------------------------------------------------------------ */

let macroCache: {
  at: number;
  us10y: number | null;
  euro10y: number | null;
  sp500PE: number | null;
} | null = null;

async function macroBase() {
  if (macroCache && Date.now() - macroCache.at < 3600_000) return macroCache;
  const [tnx, ecb, spy] = await Promise.all([
    chartPrice("^TNX").catch(() => null),
    fetchWithTimeout(
      "https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?lastNObservations=1&format=csvdata",
      { headers: { Accept: "text/csv" } },
    )
      .then(async (r) => (r.ok ? parseEcbCsv(await r.text()) : null))
      .catch(() => null),
    quoteSummary("SPY", ["summaryDetail"]).catch(() => null),
  ]);
  const spyPe = spy ? (spy["summaryDetail"] as Json | undefined)?.["trailingPE"] : null;
  const pe =
    spyPe && typeof spyPe === "object" && "raw" in (spyPe as Json)
      ? Number((spyPe as Json)["raw"])
      : null;
  macroCache = {
    at: Date.now(),
    us10y: tnx != null ? tnx / 100 : null,
    euro10y: ecb != null ? ecb / 100 : null,
    sp500PE: pe != null && Number.isFinite(pe) && pe > 0 ? pe : null,
  };
  return macroCache;
}

function macroFor(currency: string, base: Awaited<ReturnType<typeof macroBase>>): MacroSnapshot {
  const fallback = 0.04;
  let riskFree = base.us10y ?? fallback;
  let riskFreeLabel =
    base.us10y != null ? "Treasury dos EUA a 10 anos" : "4 % por omissão (sem dados de mercado)";
  if (currency === "EUR" && base.euro10y != null) {
    riskFree = base.euro10y;
    riskFreeLabel = "Curva AAA da zona euro a 10 anos (BCE)";
  } else if (currency !== "USD") {
    riskFreeLabel = `Treasury dos EUA a 10 anos (sem taxa própria em ${currency}: ajusta se precisares)`;
  }
  return {
    riskFree,
    riskFreeLabel,
    us10y: base.us10y,
    euro10y: base.euro10y,
    sp500PE: base.sp500PE,
  };
}

/* ------------------------------------------------------------------ */
/* Pares                                                                */
/* ------------------------------------------------------------------ */

async function peerSymbols(
  symbol: string,
): Promise<{ symbols: string[]; source: "finnhub" | "yahoo" }> {
  const key = finnhubKey();
  if (key && !symbol.includes(".")) {
    try {
      const res = await fetchWithTimeout(
        `${FINNHUB_API}/stock/peers?symbol=${encodeURIComponent(symbol)}`,
        {
          headers: { "X-Finnhub-Token": key },
        },
      );
      if (res.ok) {
        const list = ((await res.json()) as unknown[]).filter(
          (s): s is string => typeof s === "string" && s.toUpperCase() !== symbol,
        );
        if (list.length >= 3) return { symbols: list.slice(0, 10), source: "finnhub" };
      }
    } catch {
      // Sem Finnhub: segue para o Yahoo.
    }
  }
  const res = await fetchWithTimeout(
    `https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}`,
    { headers: { "User-Agent": UA, Accept: "application/json" } },
  );
  if (!res.ok) return { symbols: [], source: "yahoo" };
  const json = (await res.json()) as {
    finance?: { result?: Array<{ recommendedSymbols?: Array<{ symbol?: string }> }> };
  };
  const symbols = (json.finance?.result?.[0]?.recommendedSymbols ?? [])
    .map((r) => r.symbol)
    .filter((s): s is string => typeof s === "string" && s.toUpperCase() !== symbol);
  return { symbols: symbols.slice(0, 10), source: "yahoo" };
}

async function fetchPeers(
  symbol: string,
  sector: string | null,
): Promise<{ peers: PeerMultiples[]; source: CompanyData["peerSource"] }> {
  const { symbols, source } = await peerSymbols(symbol);
  const rows = await mapWithConcurrency(symbols, 4, async (s) => {
    try {
      const q = await quoteSummary(s, PEER_MODULES);
      return q ? peerFromSummary(s, q) : null;
    } catch {
      return null;
    }
  });
  let peers = rows.filter((p): p is PeerMultiples => p != null);
  if (sector) {
    const same = peers.filter((p) => p.sector === sector);
    peers = same.length >= 3 ? same : peers.filter((p) => p.sector === sector || !p.sector);
  }
  return { peers: peers.slice(0, 8), source: peers.length ? source : "none" };
}

/* ------------------------------------------------------------------ */
/* Empresa                                                              */
/* ------------------------------------------------------------------ */

const cache = new Map<string, { at: number; data: CompanyData }>();
const CACHE_TTL_MS = 30 * 60_000;

export interface FetchOptions {
  peers?: boolean;
  news?: boolean;
}

export async function fetchCompanyData(
  symbol: string,
  opts: FetchOptions = {},
): Promise<CompanyData> {
  const sym = symbol.trim().toUpperCase();
  const withPeers = opts.peers !== false;
  const withNews = opts.news !== false;
  const key = `${sym}|${withPeers}|${withNews}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const [q, ts, history, base, news] = await Promise.all([
    quoteSummary(sym, SUMMARY_MODULES),
    timeseries(sym).catch(() => null),
    priceHistory(sym).catch(() => []),
    macroBase(),
    withNews
      ? newsFor(sym)
          // Nas bolsas europeias (ASML.AS) a pesquisa pelo símbolo completo vem vazia.
          .then((n) => (n.length || !sym.includes(".") ? n : newsFor(sym.split(".")[0]!)))
          .catch(() => [] as NewsItem[])
      : Promise.resolve([] as NewsItem[]),
  ]);
  if (!q)
    throw new Error(
      `Não encontrei «${sym}» no Yahoo Finance. Confirma o símbolo (ex.: ASML.AS, SAN.MC).`,
    );
  const basics = summaryBasics(q);
  if (!basics) throw new Error(`O Yahoo Finance não tem cotação para «${sym}».`);
  const quoteType = (q["price"] as Json | undefined)?.["quoteType"];
  if (typeof quoteType === "string" && quoteType !== "EQUITY") {
    throw new Error("A avaliação é para ações e REITs. Para ETFs usa a ficha do ETF na carteira.");
  }
  if (!ts || ts.periods.length < 2) {
    throw new Error("O Yahoo Finance não tem demonstrações financeiras suficientes desta empresa.");
  }

  const warnings: string[] = [];
  const financialCurrency = (ts.currency ?? basics.financialCurrency).toUpperCase();
  let fx = 1;
  if (financialCurrency !== basics.priceCurrency) {
    const rate = await fxRate(financialCurrency, basics.priceCurrency).catch(() => null);
    if (rate == null) {
      throw new Error(
        `As contas estão em ${financialCurrency} e a cotação em ${basics.priceCurrency}, mas não consegui o câmbio. Tenta outra vez.`,
      );
    }
    fx = rate;
    warnings.push(
      `Contas convertidas de ${financialCurrency} para ${basics.priceCurrency} ao câmbio de hoje (1 ${financialCurrency} = ${formatNumber(rate, 4)} ${basics.priceCurrency}).`,
    );
  }

  const profile = buildProfile(sym, q, financialCurrency, fx);
  const market = buildMarket(q, basics);
  if (!(market.shares > 0))
    throw new Error("Sem número de ações nem capitalização para esta empresa.");
  const statements = buildStatements(ts, fx);
  if (statements.periods.length < 3) warnings.push("Só há dois anos de contas no Yahoo Finance.");

  const { peers, source } = withPeers
    ? await fetchPeers(sym, profile.sector).catch(() => ({
        peers: [] as PeerMultiples[],
        source: "none" as const,
      }))
    : { peers: [] as PeerMultiples[], source: "none" as const };

  const data: CompanyData = {
    profile,
    market,
    statements,
    trailing: buildTrailing(ts, fx),
    analysts: buildAnalysts(q, basics.factor),
    earnings: buildEarnings(q),
    insiders: buildInsiders(q),
    peers,
    peerSource: source,
    macro: macroFor(basics.priceCurrency, base),
    priceHistory: history,
    news,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), data });
  return data;
}
