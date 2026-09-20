/**
 * Fornecedor oficial: Vanguard (fundos UCITS europeus).
 *
 * As páginas de produto da Vanguard (ex.: vanguard.co.uk/professional/
 * product/etf/equity/{id}/{slug}) publicam uma tabela "Holdings details"
 * com nome, peso, setor e região por posição, e um bloco JSON-LD com o
 * ISIN — confirmado por inspeção direta de páginas reais.
 *
 * LIMITAÇÃO CONHECIDA: ao contrário da iShares, a lista pública de
 * produtos da Vanguard (.../uk-fund-directory/product) carrega os dados
 * via JavaScript no browser — confirmado por inspeção direta ("You need
 * to enable JavaScript to run view this website" no HTML devolvido a um
 * pedido simples). Não há, por isso, forma fiável de resolver
 * automaticamente ISIN → produto Vanguard com um fetch simples do lado do
 * servidor. Este fornecedor só funciona quando já existe uma referência
 * de produto em cache (`cachedRef`, resolvida uma vez e guardada em
 * asset_profiles.provider_ref) — sem ela, devolve null de forma limpa e a
 * cadeia segue para o Yahoo. Isto cobre bem os ETFs já identificados hoje,
 * mas não resolve automaticamente uma aquisição futura de um ETF Vanguard
 * novo sem essa referência ser semeada primeiro.
 */
import type {
  ManagerLookupInput,
  ManagerProvider,
  ProviderHolding,
  ProviderResult,
} from "@/lib/exposure-providers/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface VanguardProductRef {
  domain: string;
  path: string;
}

function isVanguardProductRef(v: unknown): v is VanguardProductRef {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r["domain"] === "string" && typeof r["path"] === "string";
}

function pct(raw: string): number {
  const n = Number(raw.replace(/[%,]/g, "").trim());
  return Number.isFinite(n) ? n / 100 : 0;
}

/** Extrai a tabela "Holdings details" da página de produto (HTML server-rendered). */
function parseHoldingsHtml(html: string): { asOfDate: string | null; holdings: ProviderHolding[] } {
  let asOfDate: string | null = null;
  const asOfMatch = /Holdings details[\s\S]{0,200}?As at\s+(\d{1,2}\s+\w+\s+\d{4})/i.exec(html);
  if (asOfMatch?.[1]) {
    const d = new Date(asOfMatch[1]);
    if (!Number.isNaN(d.getTime())) asOfDate = d.toISOString().slice(0, 10);
  }

  const tableMatch = /Holdings details([\s\S]*?)(?:<\/table>|Fund and benchmark)/i.exec(html);
  const scope = tableMatch?.[1] ?? "";
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const strip = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .trim();

  const holdings: ProviderHolding[] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(scope))) {
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[1] ?? ""))) {
      cells.push(strip(cellMatch[1] ?? ""));
    }
    if (cells.length < 3) continue;
    const [name, weightStr, sector, region] = cells;
    if (!name || /holding name/i.test(name)) continue;
    const weight = pct(weightStr ?? "0");
    if (!(weight > 0)) continue;
    if (/^cash/i.test(name)) continue;
    holdings.push({
      name,
      symbol: null,
      isin: null,
      weight,
      country: region || null,
      sector: sector || null,
      currency: null,
    });
  }
  return { asOfDate, holdings };
}

export const vanguardProvider: ManagerProvider = {
  slug: "vanguard",
  label: "Vanguard",
  matches: (input: ManagerLookupInput) =>
    /\bvanguard\b/.test(`${input.fundFamily ?? ""} ${input.name ?? ""}`.toLowerCase()),
  fetch: async (input: ManagerLookupInput): Promise<ProviderResult | null> => {
    try {
      const ref = isVanguardProductRef(input.cachedRef) ? input.cachedRef : null;
      if (!ref) return null;
      const res = await fetch(`https://${ref.domain}${ref.path}`, {
        headers: { "User-Agent": UA, Accept: "text/html" },
      });
      if (!res.ok) return null;
      const html = await res.text();
      const { asOfDate, holdings } = parseHoldingsHtml(html);
      if (holdings.length === 0) return null;
      return {
        source: "vanguard",
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
