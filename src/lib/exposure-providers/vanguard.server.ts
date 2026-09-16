/**
 * Fornecedor oficial: Vanguard (fundos UCITS europeus).
 *
 * As páginas de produto da Vanguard (ex.: vanguard.co.uk/professional/
 * product/etf/equity/{id}/{slug}) publicam uma tabela "Holdings details"
 * com nome, peso, setor e região por posição — confirmado por inspeção
 * direta de páginas reais. Ao contrário da iShares, a Vanguard não tem um
 * mecanismo de pesquisa por ISIN publicamente documentado e estável, pelo
 * que a resolução ISIN → produto aqui é o elo mais frágil deste fornecedor:
 * falha de forma limpa (null) sempre que não encontrar uma correspondência
 * inequívoca, nunca adivinha por semelhança de nome.
 */
import type {
  ManagerLookupInput,
  ManagerProvider,
  ProviderHolding,
  ProviderResult,
} from "@/lib/exposure-providers/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
/** Domínios institucionais Vanguard cobrindo UCITS europeus, por ordem de tentativa. */
const DOMAINS = ["www.vanguard.co.uk", "www.ie.vanguard", "www.nl.vanguard"];
const LIST_PATH = "/professional/product/list";

export interface VanguardProductRef {
  domain: string;
  path: string;
}

function isVanguardProductRef(v: unknown): v is VanguardProductRef {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r["domain"] === "string" && typeof r["path"] === "string";
}

/** Procura o ISIN (ou, na sua falta, o ticker exato) literalmente na lista de produtos e associa ao link de produto mais próximo. Nunca por nome. */
async function resolveProduct(input: ManagerLookupInput): Promise<VanguardProductRef | null> {
  const needle = input.isin ?? input.ticker;
  if (!needle) return null;
  for (const domain of DOMAINS) {
    try {
      const res = await fetch(`https://${domain}${LIST_PATH}`, {
        headers: { "User-Agent": UA, Accept: "text/html" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const idx = html.toUpperCase().indexOf(needle.toUpperCase());
      if (idx < 0) continue;
      // Procura o link de produto mais próximo do termo encontrado, num raio
      // pequeno, para evitar associar ao produto errado.
      const window = html.slice(Math.max(0, idx - 800), idx + 800);
      const m = /href="(\/professional\/product\/etf\/[a-z-]+\/\d+\/[a-z0-9-]+)"/i.exec(window);
      if (!m || !m[1]) continue;
      return { domain, path: m[1] };
    } catch {
      continue;
    }
  }
  return null;
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
      let ref = isVanguardProductRef(input.cachedRef) ? input.cachedRef : null;
      if (!ref) {
        ref = await resolveProduct(input);
        if (!ref) return null;
      }
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
