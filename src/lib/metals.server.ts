/** Preço spot de metais preciosos a partir de dados estruturados do Yahoo Finance (sem scraping, sem LLM). */
import { fetchYahoo, getRateToEUR } from "@/lib/yahoo.server";
import { toPricePerGram, type Quote } from "@/lib/prices";
import { buybackPrice } from "@/lib/metals";

/** Símbolos de futuros contínuos, cotados em USD por onça troy. */
const METAL_SYMBOLS: Record<string, string> = {
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

/**
 * Devolve o preço de RECOMPRA por grama em EUR: spot (USD/oz → EUR/g ao
 * câmbio atual) × (1 − desconto). Com o spot da Elementum a diferença
 * medida foi de ~0,3 % (2026-10-12).
 */
export async function fetchMetalSpot(
  metalType: string | null,
  ticker: string | null,
  discount: number,
  rateCache: Map<string, number | null> = new Map(),
): Promise<Quote | null> {
  const symbol = metalSymbol(metalType, ticker);
  if (!symbol) return null;
  const quote = await fetchYahoo(symbol);
  if (!quote) return null;
  const currency = (quote.currency || "USD").toUpperCase();
  if (!Number.isFinite(quote.price) || quote.price <= 0) return null;
  const rate = await getRateToEUR(currency, rateCache);
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  const spotEur = toPricePerGram(quote.price, "troy_ounce") * rate;
  return {
    price: buybackPrice(spotEur, discount),
    currency: "EUR",
    source: `yahoo:${symbol}`,
    unit: "gram",
  };
}
