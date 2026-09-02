/**
 * Lógica pura de preços — determinística, sem rede e sem LLM.
 * Toda a informação financeira vem de APIs estruturadas (ver yahoo.server.ts).
 */

export const TROY_OUNCE_GRAMS = 31.1034768;

export type MetalUnit = "troy_ounce" | "gram" | "kilogram";

export interface Quote {
  /** Preço na moeda nativa, já normalizado para a unidade interna. */
  price: number;
  currency: string;
  source: string;
  /** Unidade original devolvida pela fonte (apenas metais). */
  unit?: MetalUnit;
}

export interface PriceablePosition {
  id: string;
  name: string;
  class: string;
  quantity: number | null;
  current_price: number | null;
  current_price_native: number | null;
  native_currency: string | null;
}

export interface PricePatch {
  current_price: number;
  current_price_native: number;
  native_currency: string;
  current_value: number;
  price_source: string;
  price_updated_at: string;
  fx_rate: number;
  fx_updated_at: string;
}

export type PlanResult =
  | { ok: true; patch: PricePatch }
  | { ok: false; error: string };

export function isValidPrice(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export function isValidCurrency(v: unknown): v is string {
  return typeof v === "string" && /^[A-Z]{3}$/.test(v);
}

/** Converte um preço por onça troy / kg para preço por grama. */
export function toPricePerGram(price: number, unit: MetalUnit): number {
  if (!isValidPrice(price)) throw new Error("Preço inválido.");
  if (unit === "gram") return price;
  if (unit === "kilogram") return price / 1000;
  return price / TROY_OUNCE_GRAMS;
}

/** Valor da posição na moeda nativa. */
export function positionValueNative(quantity: number, priceNative: number): number {
  return Math.max(0, quantity) * priceNative;
}

/** Valor da posição em EUR = quantidade × preço nativo × taxa de câmbio. */
export function positionValueEUR(quantity: number, priceNative: number, fxRate: number): number {
  return positionValueNative(quantity, priceNative) * fxRate;
}

/**
 * Decide a atualização de um ativo. Devolve erro (sem patch) sempre que os dados
 * da API forem inválidos — nunca destrói o último preço válido.
 */
export function planPriceUpdate(
  asset: PriceablePosition,
  quote: Quote | null,
  fxRate: number | null,
  now: Date = new Date(),
): PlanResult {
  if (!quote) return { ok: false, error: "Sem cotação da fonte." };
  if (!isValidPrice(quote.price)) return { ok: false, error: "Preço inválido devolvido pela fonte." };
  if (!isValidCurrency(quote.currency)) return { ok: false, error: "Moeda inválida devolvida pela fonte." };
  if (!isValidPrice(fxRate)) return { ok: false, error: `Sem taxa de câmbio ${quote.currency}→EUR.` };

  const quantity = Number(asset.quantity ?? 0);
  if (quantity < 0) return { ok: false, error: "Quantidade negativa." };

  const iso = now.toISOString();
  const priceEur = quote.price * fxRate;
  return {
    ok: true,
    patch: {
      current_price: priceEur,
      current_price_native: quote.price,
      native_currency: quote.currency,
      current_value: positionValueEUR(quantity, quote.price, fxRate),
      price_source: quote.source,
      price_updated_at: iso,
      fx_rate: fxRate,
      fx_updated_at: iso,
    },
  };
}

export interface UpdateOutcome {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
  source?: string;
}

/**
 * Percorre todos os ativos com um fornecedor de cotações injetável.
 * Um erro num ativo nunca interrompe os restantes.
 */
export async function runPriceUpdate(
  assets: PriceablePosition[],
  getQuote: (asset: PriceablePosition) => Promise<Quote | null>,
  getRate: (currency: string) => Promise<number | null>,
  save: (asset: PriceablePosition, patch: PricePatch) => Promise<void>,
  now: Date = new Date(),
): Promise<{ updated: number; failed: UpdateOutcome[]; results: UpdateOutcome[] }> {
  const results: UpdateOutcome[] = [];
  for (const asset of assets) {
    try {
      const quote = await getQuote(asset);
      const rate = quote ? await getRate(quote.currency) : null;
      const plan = planPriceUpdate(asset, quote, rate, now);
      if (!plan.ok) {
        results.push({ id: asset.id, name: asset.name, ok: false, error: plan.error });
        continue;
      }
      await save(asset, plan.patch);
      results.push({ id: asset.id, name: asset.name, ok: true, source: plan.patch.price_source });
    } catch (e) {
      results.push({
        id: asset.id,
        name: asset.name,
        ok: false,
        error: e instanceof Error ? e.message : "Erro desconhecido.",
      });
    }
  }
  const failed = results.filter((r) => !r.ok);
  return { updated: results.length - failed.length, failed, results };
}
