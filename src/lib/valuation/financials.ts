/**
 * Avaliação de bancos e financeiras pelo capital próprio (em vez de EBIT e WACC).
 *
 *   P/VC justificado = (ROE − g) / (kₑ − g)
 *   Retorno em excesso: valor = VC₀ + Σ (ROE − kₑ) × VCₜ₋₁ / (1 + kₑ)ᵗ + valor terminal
 */

import { avgLast, clamp, isNum, safeDiv } from "@/lib/valuation/stats";
import type { AnnualStatements } from "@/lib/valuation/types";

/** ROE médio dos últimos 3 anos (resultado / capital próprio médio). */
export function averageRoe(s: AnnualStatements): number | null {
  const roes = s.periods.map((_, i) => {
    const eq = s.equity[i];
    const prev = i > 0 ? s.equity[i - 1] : null;
    const base = isNum(eq) && isNum(prev) ? (eq + prev) / 2 : eq;
    return isNum(base) && base > 0 ? safeDiv(s.netIncome[i], base) : null;
  });
  return avgLast(roes, 3);
}

export interface BankValuationInputs {
  bookValue: number;
  shares: number;
  roe: number;
  costOfEquity: number;
  terminalGrowth: number;
  /** Fração do lucro distribuída (dividendos / resultado). */
  payout: number;
}

export interface BankValuation {
  /** ROE usado (limitado a −10 %…35 %). */
  roe: number | null;
  justifiedPb: number | null;
  justifiedPbValue: number | null;
  excessReturnValue: number | null;
  /** Retorno em excesso de cada ano dos 5 explícitos. */
  years: { year: number; bookValue: number; excessReturn: number; presentValue: number }[];
}

export function bankValuation(i: BankValuationInputs): BankValuation {
  const empty: BankValuation = {
    roe: null,
    justifiedPb: null,
    justifiedPbValue: null,
    excessReturnValue: null,
    years: [],
  };
  if (!isNum(i.bookValue) || i.bookValue <= 0 || !isNum(i.shares) || i.shares <= 0) return empty;
  const ke = i.costOfEquity;
  const g = Math.min(i.terminalGrowth, ke - 0.01);
  const roe = clamp(i.roe, -0.1, 0.35);
  const justifiedPb = ke > g ? (roe - g) / (ke - g) : null;
  const bvps = i.bookValue / i.shares;
  const justifiedPbValue = isNum(justifiedPb) && justifiedPb > 0 ? justifiedPb * bvps : null;

  const retention = clamp(1 - i.payout, 0, 1);
  const bvGrowth = clamp(roe * retention, -0.05, 0.15);
  const years: BankValuation["years"] = [];
  let bv = i.bookValue;
  let pv = 0;
  for (let t = 1; t <= 5; t++) {
    const excessReturn = (roe - ke) * bv;
    const presentValue = excessReturn / (1 + ke) ** t;
    pv += presentValue;
    years.push({ year: t, bookValue: bv, excessReturn, presentValue });
    bv *= 1 + bvGrowth;
  }
  const roeTerminal = roe > ke ? ke + (roe - ke) * 0.5 : roe;
  const tv = ((roeTerminal - ke) * bv) / (ke - g) / (1 + ke) ** 5;
  const equity = i.bookValue + pv + tv;
  return {
    roe,
    justifiedPb,
    justifiedPbValue,
    excessReturnValue: equity > 0 ? equity / i.shares : null,
    years,
  };
}
