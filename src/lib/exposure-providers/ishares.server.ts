/**
 * Fornecedor oficial: iShares (BlackRock).
 *
 * Mecanismo documentado e amplamente usado (CSV oficial de holdings por
 * fundo): https://www.ishares.com/{locale}/.../products/{productId}/{slug}/
 * 1467271812596.ajax?fileType=csv&fileName=X_holdings&dataType=fund
 * O identificador "1467271812596" é uma constante da plataforma (o mesmo
 * em todos os fundos), não específico de cada ETF.
 *
 * A resolução ISIN/ticker → productId usa a página pública de lista de
 * produtos da iShares (estática, sem JavaScript — confirmado por inspeção
 * direta em .../ch/individual/en/products/etf-product-list, que expõe o
 * ticker e o link do produto para cada um dos ~550 fundos). Casa por
 * ticker exato (a lista não mostra ISIN nesta vista); nunca por nome.
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
const PRODUCT_LIST_URL = `https://www.ishares.com/${LOCALE}/products/etf-product-list`;

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
/**
 * Resolve para {productId, slug} varrendo a lista pública de produtos da
 * iShares (estática, confirmada por inspeção real), casando pelo texto do
 * link do ticker. Casa por ticker exato (a lista não expõe ISIN nesta
 * vista) — nunca por nome, para não associar ao ETF errado.
 */
async function resolveProduct(input: ManagerLookupInput): Promise<IsharesProductRef | null> {
  if (!input.ticker) return null;
  // Ex.: "IESE.NL" -> "IESE" (o sufixo de bolsa é convenção do Yahoo, não da iShares).
  const bareTicker = input.ticker.split(".")[0]?.toUpperCase();
  if (!bareTicker) return null;
  try {
    const res = await fetch(PRODUCT_LIST_URL, {
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Ex.: <a href="/ch/individual/en/products/251767/ishares-msci-europe-sri-ucits-etf">IESE</a>
    const linkRe =
      /<a[^>]+href="(\/ch\/individual\/en\/products\/(\d+)\/([a-z0-9-]+))"[^>]*>\s*([A-Za-z0-9]+)\s*<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html))) {
      const productId = m[2];
      const slug = m[3];
      const linkText = m[4];
      if (!productId || !slug || !linkText) continue;
      if (linkText.toUpperCase() === bareTicker) {
        return { productId, slug, locale: LOCALE };
      }
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
