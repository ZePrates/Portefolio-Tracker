/**
 * Fornecedor oficial: iShares (BlackRock).
 *
 * Mecanismo documentado e amplamente usado (CSV oficial de holdings por
 * fundo): https://www.ishares.com/{locale}/.../products/{productId}/{slug}/
 * 1467271812596.ajax?fileType=csv&fileName=X_holdings&dataType=fund
 * O identificador "1467271812596" é uma constante da plataforma (o mesmo
 * em todos os fundos), não específico de cada ETF.
 *
 * A resolução ISIN → productId usa o ecrã de pesquisa de produtos da
 * iShares (product-screener). É a parte menos garantida deste fornecedor:
 * se o formato mudar, falha de forma limpa (devolve null) e a cadeia segue
 * para o próximo fornecedor — nunca corrompe dados.
 */
import type {
  ManagerLookupInput,
  ManagerProvider,
  ProviderHolding,
  ProviderResult,
} from "@/lib/exposure-providers/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const ASSET_ID = "1467271812596";
/** Locale europeu (inglês) usado como catálogo de pesquisa para ETFs UCITS. */
const LOCALE = "ch/individual/en";

export interface IsharesProductRef {
  productId: string;
  slug: string;
  locale: string;
}

function isIsharesProductRef(v: unknown): v is IsharesProductRef {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r["productId"] === "string" && typeof r["slug"] === "string";
}

/** Tenta várias formas plausíveis de o screener devolver a lista de fundos. */
function extractScreenerRows(json: unknown): Array<Record<string, unknown>> {
  const root = json as Record<string, unknown> | null;
  const data = (root?.["data"] ?? root) as Record<string, unknown> | undefined;
  const tableData = data?.["tableData"] as Record<string, unknown> | undefined;
  const rows = tableData?.["data"] ?? tableData?.["rows"] ?? data?.["funds"] ?? data?.["results"];
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/** Extrai um campo de uma linha do screener, tolerando várias formas (string direta, {value: ...}, {raw: ...}). */
function field(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      const inner =
        (v as Record<string, unknown>)["value"] ?? (v as Record<string, unknown>)["raw"];
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    }
  }
  return null;
}

/** Resolve para {productId, slug} pesquisando o screener de produtos iShares, por ISIN ou, na sua falta, por ticker exato (nunca por nome — evita associar ao ETF errado). */
async function resolveProduct(input: ManagerLookupInput): Promise<IsharesProductRef | null> {
  if (!input.isin && !input.ticker) return null;
  const url =
    `https://www.ishares.com/${LOCALE}/product-screener/product-screener-v3.jsn` +
    `?dcrPath=/templatedata/config/product-screener-v3/data/en/${LOCALE.replace("/", "-")}/product-screener/product-screener` +
    `&siteEntryPassthrough=true`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    const rows = extractScreenerRows(json);
    for (const row of rows) {
      const rowIsin = field(row, "isin", "Isin", "ISIN");
      const rowTicker = field(row, "localExchangeTicker", "ticker", "fundTicker");
      const isinMatch = input.isin && rowIsin && rowIsin.toUpperCase() === input.isin.toUpperCase();
      const tickerMatch =
        !input.isin &&
        input.ticker &&
        rowTicker &&
        rowTicker.toUpperCase() === input.ticker.toUpperCase();
      if (!isinMatch && !tickerMatch) continue;
      const pageUrl = field(row, "productPageUrl", "fundUrl", "url");
      if (!pageUrl) continue;
      // Ex.: /ch/individual/en/products/251882/ishares-msci-world-ucits-etf-acc-fund
      const m = /\/products\/(\d+)\/([a-z0-9-]+)/i.exec(pageUrl);
      if (!m || !m[1] || !m[2]) continue;
      return { productId: m[1], slug: m[2], locale: LOCALE };
    }
    return null;
  } catch {
    return null;
  }
}

function parseHoldingsCsv(text: string): { asOfDate: string | null; holdings: ProviderHolding[] } {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  let asOfDate: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^Fund Holdings as of/i.test(line)) {
      const m = /"?([A-Za-z]+ \d{1,2}, \d{4})"?/.exec(line);
      if (m?.[1]) {
        const d = new Date(m[1]);
        if (!Number.isNaN(d.getTime())) asOfDate = d.toISOString().slice(0, 10);
      }
    }
    if (/^Ticker,Name,/i.test(line)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { asOfDate, holdings: [] };

  const cols = splitCsvLine(lines[headerIdx] ?? "").map((c) => c.trim());
  const idx = (name: string) => cols.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  const iTicker = idx("Ticker");
  const iName = idx("Name");
  const iSector = idx("Sector");
  const iAssetClass = idx("Asset Class");
  const iWeight = idx("Weight (%)");
  const iLocation = idx("Location");
  const iCurrency = idx("Currency");
  const iIsin = idx("ISIN");

  const holdings: ProviderHolding[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const cells = splitCsvLine(raw);
    if (cells.length < cols.length - 1) continue;
    const name = (cells[iName] ?? "").trim();
    const weightRaw = (cells[iWeight] ?? "").replace(/,/g, "").trim();
    const weight = Number(weightRaw) / 100;
    if (!name || !(weight > 0)) continue;
    // Ignora linhas de cash/liquidez — não são uma empresa e não devem ser
    // apresentadas como holding, mas o peso fica de fora da cobertura
    // (corretamente: não é conhecido como "empresa").
    const assetClass = (cells[iAssetClass] ?? "").trim().toLowerCase();
    if (assetClass === "cash" || /^cash/i.test(name)) continue;
    holdings.push({
      name,
      symbol: (cells[iTicker] ?? "").trim() || null,
      isin: iIsin >= 0 ? (cells[iIsin] ?? "").trim() || null : null,
      weight,
      country: (cells[iLocation] ?? "").trim() || null,
      sector: (cells[iSector] ?? "").trim() || null,
      currency: (cells[iCurrency] ?? "").trim() || null,
    });
  }
  return { asOfDate, holdings };
}

/** CSV simples com suporte a campos entre aspas (o formato da iShares usa aspas em todos os campos texto). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export const isharesProvider: ManagerProvider = {
  slug: "ishares",
  label: "iShares",
  matches: (input: ManagerLookupInput) => {
    const h = `${input.fundFamily ?? ""} ${input.name ?? ""}`.toLowerCase();
    return /\bishares\b/.test(h) || /\bblackrock\b/.test(h);
  },
  fetch: async (input: ManagerLookupInput): Promise<ProviderResult | null> => {
    try {
      let ref = isIsharesProductRef(input.cachedRef) ? input.cachedRef : null;
      if (!ref) {
        ref = await resolveProduct(input);
        if (!ref) return null;
      }
      const csvUrl =
        `https://www.ishares.com/${ref.locale}/products/${ref.productId}/${ref.slug}/` +
        `${ASSET_ID}.ajax?fileType=csv&fileName=${encodeURIComponent(input.ticker ?? "fund")}_holdings&dataType=fund`;
      const res = await fetch(csvUrl, { headers: { "User-Agent": UA, Accept: "text/csv" } });
      if (!res.ok) return null;
      const text = await res.text();
      const { asOfDate, holdings } = parseHoldingsCsv(text);
      if (holdings.length === 0) return null;
      return {
        source: "ishares",
        asOfDate,
        isin: input.isin,
        officialName: null,
        holdings,
        providerRef: ref,
      };
    } catch {
      return null;
    }
  },
};
