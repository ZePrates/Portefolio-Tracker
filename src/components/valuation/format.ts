/** Formatação da página de avaliação (sempre pelos helpers PT-PT de `lib/format`). */

import { formatCompact, formatMoney, formatNumber, formatPct } from "@/lib/format";
import { isNum } from "@/lib/valuation/stats";

export const EMPTY = "—";

export const money = (v: number | null | undefined, currency: string) =>
  isNum(v) ? formatMoney(v, currency) : EMPTY;

/** Fração em percentagem ("12,5 %"). */
export const pct = (v: number | null | undefined, decimals = 1) =>
  isNum(v) ? formatPct(v * 100, decimals) : EMPTY;

/** Fração em percentagem com sinal ("+12,5 %"). */
export const signedPct = (v: number | null | undefined, decimals = 1) =>
  isNum(v) ? `${v > 0 ? "+" : ""}${formatPct(v * 100, decimals)}` : EMPTY;

export const mult = (v: number | null | undefined, decimals = 1) =>
  isNum(v) ? `${formatNumber(v, decimals)}×` : EMPTY;

/** Múltiplo de lucros: com prejuízo (negativo) não tem leitura. */
export const positiveMult = (v: number | null | undefined, decimals = 1) =>
  isNum(v) ? (v > 0 ? `${formatNumber(v, decimals)}×` : "Prejuízo") : EMPTY;

export const num = (v: number | null | undefined, decimals = 2) =>
  isNum(v) ? formatNumber(v, decimals) : EMPTY;

/** Valores grandes abreviados ("1,3 mM USD"). */
export const big = (v: number | null | undefined, currency: string) =>
  isNum(v) ? `${formatCompact(v)} ${currency}` : EMPTY;

/** Tom de uma nota de 0 a 100 (o número aparece sempre: nunca só a cor). */
export function scoreTone(score: number | null | undefined): "positive" | "negative" | "default" {
  if (!isNum(score)) return "default";
  return score >= 70 ? "positive" : score < 45 ? "negative" : "default";
}
