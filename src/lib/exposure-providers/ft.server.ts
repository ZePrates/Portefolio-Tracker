/**
 * Fornecedor de recurso: Financial Times Markets (markets.ft.com).
 *
 * Segunda opção para ETFs quando o JustETF falha por completo ou devolve
 * exposição parcial. Confirmado por inspeção real: a página
 * `/data/etfs/tearsheet/holdings?s=CODE` é servida em HTML puro (sem
 * JavaScript) com a distribuição setorial, a distribuição por região e o
 * top 10 de holdings com pesos.
 *
 * Fluxo: ISIN -> `/data/search?query=ISIN&assetClass=ETF` devolve os códigos
 * `TICKER:BOLSA:MOEDA` -> página de holdings desse código.
 *
 * Nunca inventa dados: qualquer falha devolve `null` e as linhas com peso 0
 * são descartadas (o FT publica 0,00% quando não tem a informação).
 */
import type { ProviderHolding, ProviderResult } from "@/lib/exposure-providers/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Códigos `TICKER:BOLSA[:MOEDA]` presentes na página de pesquisa do FT. */
export function parseFtSearchCodes(html: string): string[] {
  const out: string[] = [];
  const re = /tearsheet\/summary\?s=([A-Za-z0-9.\-:]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const code = m[1];
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/** Escolhe a listagem mais informativa: bolsa alemã em EUR, depois qualquer EUR. */
export function pickFtCode(codes: string[]): string | null {
  return (
    codes.find((c) => c.endsWith(":GER:EUR")) ??
    codes.find((c) => c.endsWith(":EUR")) ??
    codes.find((c) => c.split(":").length === 3) ??
    codes[0] ??
    null
  );
}

interface Row {
  cells: string[];
}

function parseTables(html: string): Array<{ header: string[]; rows: Row[] }> {
  const out: Array<{ header: string[]; rows: Row[] }> = [];
  for (const tm of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const body = tm[1] ?? "";
    let header: string[] = [];
    const rows: Row[] = [];
    for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const tr = rm[1] ?? "";
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        decode(c[1] ?? ""),
      );
      if (cells.length === 0) continue;
      if (/<th[\s>]/i.test(tr) && header.length === 0) header = cells;
      else rows.push({ cells });
    }
    out.push({ header, rows });
  }
  return out;
}

/** Primeira percentagem sem sinal (as com + ou - são variações, não pesos). */
function firstWeight(cells: string[]): number | null {
  for (const c of cells.slice(1)) {
    const m = /^(\d+(?:[.,]\d+)?)%$/.exec(c.trim());
    if (m?.[1]) return Number(m[1].replace(",", ".")) / 100;
  }
  return null;
}

export interface FtHoldingsData {
  sectorWeights: Array<{ sector: string; weight: number }>;
  countryWeights: Array<{ country: string; weight: number }>;
  holdings: Array<{ name: string; weight: number }>;
}

const PCT = /^(\d+(?:[.,]\d+)?)%$/;

/**
 * As tabelas do FT não trazem cabeçalho próprio nesta página, por isso são
 * reconhecidas pela forma das linhas:
 * - peso por nome: [nome, "x%", "y%"] (setores ou regiões);
 * - holdings: primeira célula com link para a ficha da empresa.
 */
export function parseFtHoldings(html: string): FtHoldingsData | null {
  const named: Array<Array<{ name: string; weight: number }>> = [];
  let holdings: Array<{ name: string; weight: number }> = [];

  for (const tm of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const body = tm[1] ?? "";
    const isHoldings = body.includes("/data/equities/tearsheet/summary?s=");
    const list: Array<{ name: string; weight: number }> = [];
    for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const tr = rm[1] ?? "";
      if (/<th[\s>]/i.test(tr)) continue;
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        decode(c[1] ?? ""),
      );
      if (cells.length < 3) continue;
      const rawName = cells[0] ?? "";
      const name = rawName.replace(/\s+[A-Z0-9.]+:[A-Z]+$/, "").trim();
      if (!name || PCT.test(name)) continue;
      if (isHoldings) {
        const w = firstWeight(cells);
        if (w === null || w <= 0) continue;
        list.push({ name, weight: w });
        if (list.length >= 10) break;
      } else {
        // Só linhas no formato [nome, peso, média] contam como distribuição.
        if (cells.length !== 3 || !PCT.test(cells[1] ?? "") || !PCT.test(cells[2] ?? "")) continue;
        const w = Number((cells[1] ?? "0").replace("%", "").replace(",", ".")) / 100;
        if (!Number.isFinite(w) || w <= 0) continue;
        list.push({ name, weight: w });
      }
    }
    if (list.length === 0) continue;
    if (isHoldings) holdings = list;
    else named.push(list);
  }

  const REGIONS = /americas|greater asia|greater europe|united kingdom|emerging/i;
  const sectorWeights: Array<{ sector: string; weight: number }> = [];
  const countryWeights: Array<{ country: string; weight: number }> = [];
  for (const list of named) {
    const isRegion = list.some((x) => REGIONS.test(x.name));
    if (isRegion) countryWeights.push(...list.map((x) => ({ country: x.name, weight: x.weight })));
    else sectorWeights.push(...list.map((x) => ({ sector: x.name, weight: x.weight })));
  }

  if (sectorWeights.length === 0 && countryWeights.length === 0 && holdings.length === 0)
    return null;
  return { sectorWeights, countryWeights, holdings };
}

/** Obtém a composição de um ETF no FT a partir do ISIN. `null` em qualquer falha. */
export async function fetchFtEtf(isin: string | null): Promise<ProviderResult | null> {
  if (!isin) return null;
  try {
    const search = await fetch(
      `https://markets.ft.com/data/search?query=${encodeURIComponent(isin)}&assetClass=ETF`,
      { headers: { "User-Agent": UA, Accept: "text/html" } },
    );
    if (!search.ok) return null;
    const code = pickFtCode(parseFtSearchCodes(await search.text()));
    if (!code) return null;

    const page = await fetch(
      `https://markets.ft.com/data/etfs/tearsheet/holdings?s=${encodeURIComponent(code)}`,
      { headers: { "User-Agent": UA, Accept: "text/html" } },
    );
    if (!page.ok) return null;
    const parsed = parseFtHoldings(await page.text());
    if (!parsed) return null;

    const holdings: ProviderHolding[] = parsed.holdings.map((h) => ({
      name: h.name,
      symbol: null,
      isin: null,
      weight: h.weight,
      country: null,
      sector: null,
      currency: null,
    }));

    return {
      source: "ft",
      asOfDate: null,
      isin,
      officialName: null,
      holdings,
      ...(parsed.sectorWeights.length > 0 ? { sectorWeights: parsed.sectorWeights } : {}),
      ...(parsed.countryWeights.length > 0 ? { countryWeights: parsed.countryWeights } : {}),
    };
  } catch {
    return null;
  }
}
