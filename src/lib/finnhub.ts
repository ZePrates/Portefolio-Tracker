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
