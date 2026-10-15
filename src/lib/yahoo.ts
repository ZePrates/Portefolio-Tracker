/** Helpers puros do Yahoo Finance (seguros no cliente). */

/** Converte o ticker guardado (formato Base44) para o símbolo do Yahoo Finance. */
export function toYahooSymbol(ticker: string): string | null {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  if (t.endsWith(".US")) return t.slice(0, -3);
  if (t.endsWith(".UK")) return `${t.slice(0, -3)}.L`;
  if (t.endsWith(".NL")) return `${t.slice(0, -3)}.AS`;
  return t;
}

/**
 * Símbolo Yahoo de um ativo: o guardado em `price_source` ("yahoo:VWCE.DE")
 * tem a bolsa e prevalece; só sem ele se converte o ticker ("VWCE" não existe
 * no Yahoo, por isso os ETFs ficavam sem cotação).
 */
export function yahooSymbolFor(asset: {
  ticker?: string | null;
  price_source?: string | null;
}): string | null {
  const src = asset.price_source?.trim();
  if (src?.startsWith("yahoo:") && src.length > 6) return src.slice(6).toUpperCase();
  return asset.ticker ? toYahooSymbol(asset.ticker) : null;
}

/** Resposta do endpoint `v8/finance/chart` (só os campos usados). */
export interface YahooChartJson {
  chart?: {
    result?: Array<{
      meta?: { currency?: string; exchangeTimezoneName?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
  };
}

export interface YahooHistory {
  /** Moeda normalizada: GBp/GBX → GBP e ILA → ILS, com `factor` 0,01. */
  currency: string;
  factor: number;
  points: Array<{ date: string; value: number }>;
}

/**
 * Fechos diários de uma resposta do Yahoo. A data de cada fecho é a do fuso
 * da bolsa: os pares de câmbio vêm com a hora 23:00 UTC do dia anterior,
 * por isso a data UTC ficaria um dia atrasada. Fechos vazios são ignorados.
 */
export function parseYahooHistory(json: YahooChartJson): YahooHistory | null {
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  if (!r || ts.length === 0) return null;
  const raw = r.meta?.currency ?? "EUR";
  const pence = raw === "GBp" || raw.toUpperCase() === "GBX" || raw.toUpperCase() === "ILA";
  const currency = pence ? (raw.toUpperCase() === "ILA" ? "ILS" : "GBP") : raw.toUpperCase();
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: r.meta?.exchangeTimezoneName || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" });
  }
  const byDate = new Map<string, number>();
  ts.forEach((t, i) => {
    const c = closes[i];
    if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return;
    byDate.set(fmt.format(new Date(t * 1000)), c);
  });
  const points = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
  return points.length > 0 ? { currency, factor: pence ? 0.01 : 1, points } : null;
}
