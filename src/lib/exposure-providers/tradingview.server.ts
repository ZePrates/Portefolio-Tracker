/**
 * Fornecedor de recurso: TradingView.
 *
 * Segunda opção para ETFs quando o JustETF falha por completo ou devolve
 * exposição parcial. Usa o scanner público (`scanner.tradingview.com/global/scan`)
 * filtrado por ISIN — o mesmo endpoint que alimenta o screener do site.
 *
 * Limitação confirmada por inspeção real: o scanner publica a identidade do
 * fundo (nome, moeda, domicílio, TER, ativos sob gestão) mas NÃO publica a
 * distribuição de país/setor nem as holdings. Por isso o TradingView só é
 * usado para preencher a ficha do ativo (nome oficial, moeda, domicílio);
 * a exposição continua a depender do JustETF e nunca é inventada.
 */

export interface TradingViewEtf {
  symbol: string;
  exchange: string;
  officialName: string | null;
  currency: string | null;
  domicile: string | null;
  isin: string | null;
}

/** Resposta JSON do scanner, isolada para ser testável sem rede. */
export function parseTradingViewScan(payload: unknown, isin: string): TradingViewEtf | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;

  const matches: TradingViewEtf[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const { s, d } = row as { s?: unknown; d?: unknown };
    if (typeof s !== "string" || !Array.isArray(d)) continue;
    // columns pedidas: name, currency, country, isin
    const [name, currency, country, rowIsin] = d as unknown[];
    if (rowIsin !== isin) continue;
    const [exchange = "", symbol = ""] = s.split(":");
    matches.push({
      symbol: symbol || s,
      exchange,
      officialName: typeof name === "string" && name ? name : null,
      currency: typeof currency === "string" && currency ? currency : null,
      domicile: typeof country === "string" && country ? country : null,
      isin: typeof rowIsin === "string" ? rowIsin : null,
    });
  }
  if (matches.length === 0) return null;
  // Preferir a listagem na moeda nativa mais comum (EUR), senão a primeira.
  return matches.find((m) => m.currency === "EUR") ?? matches[0]!;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Consulta o scanner público do TradingView por ISIN. `null` em qualquer falha. */
export async function fetchTradingViewEtf(isin: string | null): Promise<TradingViewEtf | null> {
  if (!isin) return null;
  try {
    const res = await fetch("https://scanner.tradingview.com/global/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({
        columns: ["name", "currency", "country", "isin"],
        filter: [{ left: "isin", operation: "equal", right: isin }],
        range: [0, 20],
      }),
    });
    if (!res.ok) return null;
    return parseTradingViewScan(await res.json(), isin);
  } catch {
    return null;
  }
}
