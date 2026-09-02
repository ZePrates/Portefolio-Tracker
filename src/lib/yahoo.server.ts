/** Acesso ao Yahoo Finance (dados estruturados, sem scraping de HTML e sem LLM). */

export interface YahooQuote {
  price: number;
  currency: string;
  name: string;
  dividends: Array<{ date: string; amount: number }>;
}

/** Converte o ticker guardado (formato Base44) para o símbolo do Yahoo Finance. */
export function toYahooSymbol(ticker: string): string | null {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  if (t.endsWith(".US")) return t.slice(0, -3);
  if (t.endsWith(".UK")) return `${t.slice(0, -3)}.L`;
  if (t.endsWith(".NL")) return `${t.slice(0, -3)}.AS`;
  return t;
}

export async function fetchYahoo(symbol: string, range = "1d"): Promise<YahooQuote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=${range}&events=div`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            currency?: string;
            longName?: string;
            shortName?: string;
          };
          events?: { dividends?: Record<string, { amount?: number; date?: number }> };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const meta = result?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
    const divs = Object.values(result?.events?.dividends ?? {})
      .filter((d) => typeof d.amount === "number" && typeof d.date === "number")
      .map((d) => ({
        date: new Date((d.date as number) * 1000).toISOString().slice(0, 10),
        amount: d.amount as number,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return {
      price,
      currency: (meta?.currency || "EUR").toUpperCase(),
      name: meta?.longName || meta?.shortName || symbol,
      dividends: divs,
    };
  } catch {
    return null;
  }
}

/** Normaliza cotações em cêntimos (GBX/ILA). */
export function normalize(quote: YahooQuote): { price: number; currency: string; factor: number } {
  let price = quote.price;
  let cur = quote.currency;
  let factor = 1;
  if (cur === "GBX" || cur === "ILA") {
    factor = 0.01;
    price = price * factor;
    cur = cur === "GBX" ? "GBP" : "ILS";
  }
  return { price, currency: cur, factor };
}

export async function getRateToEUR(
  currency: string,
  cache: Map<string, number | null>,
): Promise<number | null> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return 1;
  if (cache.has(cur)) return cache.get(cur) ?? null;
  const q = await fetchYahoo(`${cur}EUR=X`);
  const rate = q ? q.price : null;
  cache.set(cur, rate);
  return rate;
}

/**
 * Taxa de câmbio real na data indicada (fecho diário do par <MOEDA>EUR=X).
 * Se não houver dado para a data, devolve null — nunca inventa valores.
 */
export async function getRateOnDate(
  currency: string,
  date: string,
  cache: Map<string, number | null>,
): Promise<number | null> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return 1;
  const key = `${cur}@${date}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const start = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000) - 7 * 86400;
  const end = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${cur}EUR=X?interval=1d&period1=${start}&period2=${end}`;
  let rate: number | null = null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (res.ok) {
      const json = (await res.json()) as {
        chart?: {
          result?: Array<{
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
        };
      };
      const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
      for (let i = closes.length - 1; i >= 0; i -= 1) {
        const c = closes[i];
        if (typeof c === "number" && Number.isFinite(c) && c > 0) {
          rate = c;
          break;
        }
      }
    }
  } catch {
    rate = null;
  }
  cache.set(key, rate);
  return rate;
}
