/** Preço spot de metais preciosos a partir de dados estruturados do Yahoo Finance (sem scraping, sem LLM). */
import { fetchYahoo } from "@/lib/yahoo.server";
import { toPricePerGram, type Quote } from "@/lib/prices";

/** Símbolos de futuros contínuos, cotados em USD por onça troy. */
export const METAL_SYMBOLS: Record<string, string> = {
  ouro: "GC=F",
  gold: "GC=F",
  xau: "GC=F",
  prata: "SI=F",
  silver: "SI=F",
  xag: "SI=F",
  platina: "PL=F",
  platinum: "PL=F",
  paladio: "PA=F",
  palladium: "PA=F",
};

export function metalSymbol(metalType: string | null, ticker: string | null): string | null {
  if (ticker && ticker.trim()) return ticker.trim().toUpperCase();
  const key = (metalType ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  return METAL_SYMBOLS[key] ?? null;
}

/** Devolve o preço spot POR GRAMA na moeda da fonte. */
export async function fetchMetalSpot(
  metalType: string | null,
  ticker: string | null,
): Promise<Quote | null> {
  const symbol = metalSymbol(metalType, ticker);
  if (!symbol) return null;
  const quote = await fetchYahoo(symbol);
  if (!quote) return null;
  const currency = (quote.currency || "USD").toUpperCase();
  if (!Number.isFinite(quote.price) || quote.price <= 0) return null;
  return {
    price: toPricePerGram(quote.price, "troy_ounce"),
    currency,
    source: `yahoo:${symbol}`,
    unit: "troy_ounce",
  };
}
