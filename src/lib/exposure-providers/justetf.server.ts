/**
 * Fornecedor especializado: justETF.
 *
 * A ficha de cada ETF está diretamente
 * acessível por ISIN em .../en/etf-profile.html?isin={ISIN} — confirmado
 * por inspeção direta real, servida sem JavaScript. Cobre qualquer gestora
 * (2800+ ETFs UCITS europeus). É a única fonte usada pela aplicação para
 * composição e exposição de ETFs.
 *
 * Duas limitações confirmadas por inspeção real, documentadas em vez de
 * escondidas:
 * - As holdings individuais mostradas na página estão limitadas ao top 10.
 * - A distribuição de país/setor mostrada por omissão está limitada às 4
 *   maiores fatias + uma fatia "Other" que fecha em 100% (o "mostrar mais"
 *   da página carrega o resto via JavaScript, não acessível por fetch
 *   simples). Ainda assim, isto já dá cobertura de país/setor completa
 *   (100%), porque "Other" é uma fatia legítima da fonte, não um "não
 *   sabemos" — é isso que resolve o problema de cobertura parcial.
 */
import type { ProviderHolding, ProviderResult } from "@/lib/exposure-providers/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Extrai pares (nome, peso%) das tabelas "Countries"/"Sectors", identificadas
 * pelos atributos data-testid estáveis da página real.
 */
function parseNamedWeightsSection(
  html: string,
  key: "countries" | "sectors",
): Array<{ name: string; weight: number }> {
  const rowRe = new RegExp(
    `tl_etf-holdings_${key}_value_name"[^>]*>([^<]+)<[\\s\\S]{0,400}?tl_etf-holdings_${key}_value_percentage"[^>]*>\\s*([\\d.,]+)\\s*%`,
    "gi",
  );
  const out: Array<{ name: string; weight: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const name = stripTags(m[1] ?? "");
    const weight = Number((m[2] ?? "0").replace(",", "."));
    if (!name || !Number.isFinite(weight) || weight <= 0) continue;
    out.push({ name, weight: weight / 100 });
    if (out.length >= 30) break;
  }
  return out;
}

interface TopHoldingRow {
  name: string;
  isin: string | null;
  weight: number;
}

function parseTopHoldings(html: string): TopHoldingRow[] {
  const rowRe =
    /tl_etf-holdings_top-holdings_link_name"\s+href="[^"]*\/stock-profiles\/([A-Z0-9]+)"[^>]*>(?:<span>)?([^<]+)<[\s\S]{0,400}?tl_etf-holdings_top-holdings_value_percentage"[^>]*>\s*([\d.,]+)\s*%/gi;
  const out: TopHoldingRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const name = stripTags(m[2] ?? "");
    const weight = Number((m[3] ?? "0").replace(",", "."));
    if (!name || !Number.isFinite(weight) || weight <= 0) continue;
    out.push({ name, isin: m[1] ?? null, weight: weight / 100 });
    if (out.length >= 10) break;
  }
  return out;
}

function parseAsOfDate(html: string): string | null {
  const m = /As of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(html);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/**
 * Obtém a ficha JustETF de um ETF pelo ISIN.
 */
export async function fetchJustEtf(isin: string | null): Promise<ProviderResult | null> {
  if (!isin) return null;
  try {
    const res = await fetch(
      `https://www.justetf.com/en/etf-profile.html?isin=${encodeURIComponent(isin)}`,
      {
        headers: { "User-Agent": UA, Accept: "text/html" },
      },
    );
    if (!res.ok) return null;
    const html = await res.text();

    const countryWeights = parseNamedWeightsSection(html, "countries").map((c) => ({
      country: c.name,
      weight: c.weight,
    }));
    const sectorWeights = parseNamedWeightsSection(html, "sectors").map((s) => ({
      sector: s.name,
      weight: s.weight,
    }));
    const topHoldings = parseTopHoldings(html);
    const asOfDate = parseAsOfDate(html);

    // Sem nenhum dado estruturado reconhecido, não é uma fonte válida — mais vale falhar
    // de forma limpa do que guardar um resultado vazio como se fosse uma sincronização real.
    if (countryWeights.length === 0 && sectorWeights.length === 0 && topHoldings.length === 0) {
      return null;
    }

    const holdings: ProviderHolding[] = topHoldings.map((h) => ({
      name: h.name,
      symbol: null,
      isin: h.isin,
      weight: h.weight,
      country: null,
      sector: null,
      currency: null,
    }));

    return {
      source: "justetf",
      asOfDate,
      isin,
      officialName: null,
      holdings,
      ...(sectorWeights.length > 0 ? { sectorWeights } : {}),
      ...(countryWeights.length > 0 ? { countryWeights } : {}),
    };
  } catch {
    return null;
  }
}
