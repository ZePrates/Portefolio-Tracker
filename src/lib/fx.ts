/**
 * Escolha da taxa de câmbio de um movimento — lógica pura e testável.
 *
 * Para o IRS (Anexos G e J), os valores de aquisição e de realização em moeda
 * estrangeira convertem-se ao câmbio DA DATA DE CADA OPERAÇÃO, não ao de hoje.
 * Prioridade: taxa indicada pelo utilizador (ex.: extrato XTB) → taxa histórica
 * da data → taxa atual apenas para movimentos de hoje (ou como último recurso,
 * sinalizado).
 */

/** broker = câmbio efetivo do extrato importado (ex.: XTB). */
export type FxSource = "eur" | "manual" | "broker" | "historical" | "current" | "current_fallback";

export interface TradeFxInput {
  nativeCurrency: string | null | undefined;
  /** Data do movimento (YYYY-MM-DD). */
  tradedAt: string;
  /** Hoje (YYYY-MM-DD, Lisboa). */
  today: string;
  /** Taxa indicada pelo utilizador (1 unidade nativa = x EUR). */
  manualRate?: number | null;
  /** Taxa atual conhecida do ativo. */
  currentRate?: number | null;
  /** Taxa de fecho na data do movimento, se obtida. */
  historicalRate?: number | null;
}

export interface TradeFx {
  rate: number;
  source: FxSource;
}

const valid = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

export function resolveTradeFx(input: TradeFxInput): TradeFx {
  const currency = (input.nativeCurrency || "EUR").toUpperCase();
  if (currency === "EUR") return { rate: 1, source: "eur" };
  if (valid(input.manualRate)) return { rate: input.manualRate, source: "manual" };

  const isToday = input.tradedAt.slice(0, 10) >= input.today;
  if (isToday && valid(input.currentRate)) return { rate: input.currentRate, source: "current" };
  if (valid(input.historicalRate)) return { rate: input.historicalRate, source: "historical" };
  if (valid(input.currentRate)) return { rate: input.currentRate, source: "current_fallback" };
  throw new Error(
    `Sem taxa de câmbio ${currency}→EUR para ${input.tradedAt}. Indica-a manualmente.`,
  );
}

/** Precisa de ir buscar a taxa histórica? (evita chamadas de rede desnecessárias) */
export function needsHistoricalRate(input: Omit<TradeFxInput, "historicalRate">): boolean {
  const currency = (input.nativeCurrency || "EUR").toUpperCase();
  if (currency === "EUR" || valid(input.manualRate)) return false;
  return !(input.tradedAt.slice(0, 10) >= input.today && valid(input.currentRate));
}

/** Taxa atual de um ativo: a guardada pela atualização de preços ou a implícita no preço. */
export function currentRateOf(asset: {
  native_currency?: string | null;
  fx_rate?: number | null;
  current_price?: number | null;
  current_price_native?: number | null;
}): number | null {
  if ((asset.native_currency || "EUR").toUpperCase() === "EUR") return 1;
  if (valid(asset.fx_rate)) return asset.fx_rate;
  if (valid(asset.current_price) && valid(asset.current_price_native)) {
    return asset.current_price / asset.current_price_native;
  }
  return null;
}
