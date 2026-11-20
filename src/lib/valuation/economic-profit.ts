/**
 * Lucro económico: EVA, EP e MVA (Stern Stewart & Co.).
 *
 *   NOPAT = EBIT × (1 − t)
 *   Capital investido (CI) = capital próprio + dívida + minoritários − caixa
 *   ROIC  = NOPAT / CI do início do ano
 *   EVA   = NOPAT − WACC × CI      (= EP = (ROIC − WACC) × CI)
 *   MVA   = valor de mercado da empresa − CI
 *   Valor das operações atuais (COV) = CI + EVA / WACC
 *
 * Avaliação: valor da empresa = CI₀ + Σ EVAₜ / (1 + WACC)ᵗ + valor terminal,
 * com o ROIC a convergir para WACC + 30 % do diferencial atual (uma vantagem
 * competitiva que se desgasta) e o capital a crescer como a receita.
 */

import { at, clamp, isNum, safeDiv } from "@/lib/valuation/stats";
import type { AnnualStatements } from "@/lib/valuation/types";

export interface EvaYear {
  period: string;
  investedCapital: number | null;
  nopat: number | null;
  roic: number | null;
  eva: number | null;
}

/** Capital investido de cada ano. */
export function investedCapitalSeries(s: AnnualStatements): (number | null)[] {
  return s.periods.map((_, i) => {
    const eq = s.equity[i];
    if (!isNum(eq)) return null;
    const ic = eq + (s.totalDebt[i] ?? 0) + (s.minorityInterest[i] ?? 0) - (s.cash[i] ?? 0);
    return ic > 0 ? ic : null;
  });
}

/** Taxa efetiva de imposto de um ano (entre 0 e 45 %), ou a alternativa. */
export function effectiveTaxAt(s: AnnualStatements, i: number, fallback: number): number {
  const t = safeDiv(s.taxProvision[i], s.pretaxIncome[i]);
  return isNum(t) && (s.pretaxIncome[i] ?? 0) > 0 ? clamp(t, 0, 0.45) : fallback;
}

export function evaHistory(s: AnnualStatements, wacc: number, marginalTax: number): EvaYear[] {
  const ic = investedCapitalSeries(s);
  return s.periods.map((period, i) => {
    const ebit = s.operatingIncome[i];
    const nopat = isNum(ebit)
      ? ebit * (1 - (ebit > 0 ? effectiveTaxAt(s, i, marginalTax) : 0))
      : null;
    const base = (i > 0 ? ic[i - 1] : null) ?? ic[i] ?? null;
    const roic = safeDiv(nopat, base);
    const eva = isNum(nopat) && isNum(base) ? nopat - wacc * base : null;
    return { period, investedCapital: ic[i] ?? null, nopat, roic, eva };
  });
}

export interface EvaValuationInputs {
  investedCapital: number;
  roic: number;
  wacc: number;
  /** Crescimento do capital nos anos 1–5 (o da receita). */
  growth: number;
  terminalGrowth: number;
  /** Fração do diferencial ROIC − WACC que persiste no longo prazo. */
  persistence: number;
  cash: number;
  debt: number;
  minorityInterest: number;
  shares: number;
}

export interface EvaValuation {
  years: { year: number; roic: number; capital: number; eva: number; presentValue: number }[];
  terminalRoic: number;
  pvEva: number;
  pvTerminal: number;
  firmValue: number;
  equityValue: number;
  perShare: number;
}

export function evaValuation(i: EvaValuationInputs): EvaValuation | null {
  if (
    !isNum(i.investedCapital) ||
    i.investedCapital <= 0 ||
    !isNum(i.roic) ||
    !isNum(i.shares) ||
    i.shares <= 0 ||
    i.wacc <= i.terminalGrowth + 0.005
  ) {
    return null;
  }
  const roic0 = clamp(i.roic, -0.3, 0.6);
  const spread0 = roic0 - i.wacc;
  const terminalRoic =
    spread0 > 0 ? i.wacc + Math.min(0.1, spread0 * clamp(i.persistence, 0, 1)) : i.wacc;
  const years: EvaValuation["years"] = [];
  let capital = i.investedCapital;
  let pvEva = 0;
  for (let t = 1; t <= 10; t++) {
    const roic = roic0 + ((terminalRoic - roic0) * t) / 10;
    const eva = (roic - i.wacc) * capital;
    const presentValue = eva / (1 + i.wacc) ** t;
    pvEva += presentValue;
    years.push({ year: t, roic, capital, eva, presentValue });
    const g = t <= 5 ? i.growth : i.growth - ((i.growth - i.terminalGrowth) * (t - 5)) / 5;
    capital *= 1 + Math.max(-0.1, g);
  }
  const terminalEva = (terminalRoic - i.wacc) * capital;
  const pvTerminal =
    terminalEva > 0 ? terminalEva / (i.wacc - i.terminalGrowth) / (1 + i.wacc) ** 10 : 0;
  const firmValue = i.investedCapital + pvEva + pvTerminal;
  const equityValue = firmValue + i.cash - i.debt - i.minorityInterest;
  return {
    years,
    terminalRoic,
    pvEva,
    pvTerminal,
    firmValue,
    equityValue,
    perShare: equityValue / i.shares,
  };
}

export interface ValueCreation {
  /** Valor de mercado da empresa (EV) − capital investido. */
  mva: number | null;
  /** Valor das operações atuais: CI + EVA / WACC. */
  currentOperationsValue: number | null;
  /** Parte do EV que só se justifica com crescimento futuro. */
  futureGrowthValue: number | null;
  futureGrowthShare: number | null;
}

export function valueCreation(
  s: AnnualStatements,
  marketEnterpriseValue: number,
  lastEva: number | null,
  wacc: number,
): ValueCreation {
  const ic = at(investedCapitalSeries(s));
  if (!isNum(ic)) {
    return {
      mva: null,
      currentOperationsValue: null,
      futureGrowthValue: null,
      futureGrowthShare: null,
    };
  }
  const cov = isNum(lastEva) && wacc > 0 ? ic + lastEva / wacc : null;
  const fgv = isNum(cov) ? marketEnterpriseValue - cov : null;
  return {
    mva: marketEnterpriseValue - ic,
    currentOperationsValue: cov,
    futureGrowthValue: fgv,
    futureGrowthShare: safeDiv(fgv, marketEnterpriseValue),
  };
}
