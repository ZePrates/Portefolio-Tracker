/**
 * Fornecedor especializado: justETF.
 *
 * Ao contrário dos fornecedores por gestora (iShares/Vanguard), este NÃO
 * precisa de resolução ISIN → produto: a ficha de cada ETF está diretamente
 * acessível por ISIN em .../en/etf-profile.html?isin={ISIN} — confirmado
 * por inspeção direta real, servida sem JavaScript. Cobre qualquer gestora
 * (2800+ ETFs UCITS europeus), por isso corre como segundo nível da cadeia
 * (depois da fonte oficial da gestora, antes do Yahoo), independentemente
 * de haver ou não um ManagerProvider implementado para essa gestora — é
 * chamado diretamente pelo registo, não pelo mecanismo matches()/gestora.
 *
 * Duas limitações confirmadas por inspeção real, documentadas em vez de
 * escondidas:
 * - As holdings individuais mostradas na página estão limitadas ao top 10
 *   (tal como o Yahoo) — não resolve cobertura ao nível de holding.
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

/** Extrai pares (nome, peso%) de uma secção "Countries"/"Sectors": linhas de tabela com um nome e uma percentagem. */
function parseNamedWeightsSection(
  html: string,
  headingText: string,
): Array<{ name: string; weight: number }> {
  const headingIdx = html.indexOf(`>${headingText}<`);
  if (headingIdx < 0) return [];
  // Corta no próximo cabeçalho de secção (h3/h4), para não misturar com a
  // tabela seguinte (ex.: "Sectors" logo a seguir a "Countries").
  const sectionStart = headingIdx + headingText.length + 2;
  const nextHeadingMatch = /<h[34][^>]*>/i.exec(html.slice(sectionStart));
  const sectionEnd = nextHeadingMatch
    ? sectionStart + nextHeadingMatch.index
    : Math.min(html.length, sectionStart + 4000);
  const rest = html.slice(sectionStart, sectionEnd);
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*%\s*<\/td>/gi;
  const out: Array<{ name: string; weight: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(rest))) {
    const name = stripTags(m[1] ?? "");
    const weight = Number((m[2] ?? "0").replace(",", "."));
    if (!name || !Number.isFinite(weight) || weight <= 0) continue;
    out.push({ name, weight: weight / 100 });
    if (out.length >= 8) break; // margem de segurança
  }
  return out;
}

interface TopHoldingRow {
  name: string;
  weight: number;
}

function parseTopHoldings(html: string): TopHoldingRow[] {
  const headingIdx = html.indexOf(">Top 10 Holdings<");
  if (headingIdx < 0) return [];
  const rest = html.slice(headingIdx, headingIdx + 6000);
  const rowRe =
    /<a[^>]+href="https:\/\/www\.justetf\.com\/[a-z-]+\/stock-profiles\/[^"]+"[^>]*>([^<]+)<\/a>[\s\S]{0,200}?([\d.,]+)\s*%/gi;
  const out: TopHoldingRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(rest))) {
    const name = stripTags(m[1] ?? "");
    const weight = Number((m[2] ?? "0").replace(",", "."));
    if (!name || !Number.isFinite(weight) || weight <= 0) continue;
    out.push({ name, weight: weight / 100 });
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
 * Obtém a ficha justETF de um ETF pelo ISIN. Independente de gestora —
 * chamado diretamente pelo registo como segundo nível da cadeia (não
 * implementa a interface ManagerProvider, porque não é seletivo por gestora).
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

    const countryWeights = parseNamedWeightsSection(html, "Countries").map((c) => ({
      country: c.name,
      weight: c.weight,
    }));
    const sectorWeights = parseNamedWeightsSection(html, "Sectors").map((s) => ({
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
      isin: null,
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
