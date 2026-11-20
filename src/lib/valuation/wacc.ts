/**
 * Custo do capital: CAPM com prémio de risco do país e beta ajustado à
 * estrutura de capital (Hamada); custo da dívida pelo rating sintético.
 *
 *   rE   = rf + βL × ERP maduro + CRP
 *   βL   = βU × (1 + (1 − t) × D/E)            (Hamada)
 *   rD   = rf + spread do rating (+ spread do país)
 *   WACC = E/(D+E) × rE + D/(D+E) × rD × (1 − t)
 */

import { isNum } from "@/lib/valuation/stats";

export function unleverBeta(levered: number, debtToEquity: number, tax: number): number {
  return levered / (1 + (1 - tax) * Math.max(0, debtToEquity));
}

export function releverBeta(unlevered: number, debtToEquity: number, tax: number): number {
  return unlevered * (1 + (1 - tax) * Math.max(0, debtToEquity));
}

export function costOfEquity(
  riskFree: number,
  beta: number,
  matureErp: number,
  crp: number,
): number {
  return riskFree + beta * matureErp + crp;
}

export interface WaccInput {
  riskFree: number;
  beta: number;
  matureErp: number;
  crp: number;
  preTaxCostOfDebt: number;
  taxRate: number;
  /** Valor de mercado do capital próprio (capitalização). */
  equityValue: number;
  /** Dívida financeira (valor contabilístico, inclui locações). */
  debtValue: number;
}

export interface WaccResult {
  costOfEquity: number;
  costOfDebtAfterTax: number;
  weightEquity: number;
  weightDebt: number;
  wacc: number;
}

export function computeWacc(i: WaccInput): WaccResult {
  const ke = costOfEquity(i.riskFree, i.beta, i.matureErp, i.crp);
  const kdAfter = i.preTaxCostOfDebt * (1 - i.taxRate);
  const e = isNum(i.equityValue) && i.equityValue > 0 ? i.equityValue : 0;
  const d = isNum(i.debtValue) && i.debtValue > 0 ? i.debtValue : 0;
  const total = e + d;
  const we = total > 0 ? e / total : 1;
  const wd = total > 0 ? d / total : 0;
  return {
    costOfEquity: ke,
    costOfDebtAfterTax: kdAfter,
    weightEquity: we,
    weightDebt: wd,
    wacc: we * ke + wd * kdAfter,
  };
}
