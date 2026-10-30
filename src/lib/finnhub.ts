/**
 * Finnhub — partes puras (sem rede). Os pedidos vivem em ficheiros *.server.ts
 * ou *.functions.ts e enviam a chave no cabeçalho X-Finnhub-Token.
 */

export const FINNHUB_API = "https://api.finnhub.io/api/v1";

/** Chave do servidor; null quando não está configurada. */
export function finnhubKey(): string | null {
  const key = typeof process !== "undefined" ? process.env["FINNHUB_API_KEY"]?.trim() : "";
  return key ? key : null;
}

const pct = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100 ? v : null;

/**
 * Yield de referência (em %) a partir de `/stock/metric?metric=all`.
 * Prefere o dividendo anual indicado (último dividendo × frequência, como a
 * app), e recai no TTM. 0 é um valor válido (empresa sem dividendo).
 */
export function parseReferenceYield(json: unknown): number | null {
  const m = (json as { metric?: Record<string, unknown> } | null)?.metric;
  if (!m || typeof m !== "object") return null;
  return pct(m["dividendYieldIndicatedAnnual"]) ?? pct(m["currentDividendYieldTTM"]);
}
