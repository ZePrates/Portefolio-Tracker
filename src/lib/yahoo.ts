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
