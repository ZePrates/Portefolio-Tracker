/**
 * Modelo de desconto de dividendos (DDM) e valor das oportunidades de
 * crescimento (PVGO).
 *
 *   Gordon:        P₀ = D₁ / (kₑ − g)
 *   Duas fases:    P₀ = Σ₁⁵ D₀(1+g₁)ᵗ / (1+kₑ)ᵗ + [D₅(1+g₂) / (kₑ − g₂)] / (1+kₑ)⁵
 *   PVGO:          PVGO = P − EPS / kₑ  (parte do preço que paga crescimento futuro)
 */

import { isNum } from "@/lib/valuation/stats";

export interface DdmInputs {
  /** Dividendo anual por ação atual. */
  dividend: number;
  costOfEquity: number;
  /** Crescimento dos dividendos nos anos 1–5. */
  growth: number;
  /** Crescimento perpétuo depois do ano 5. */
  terminalGrowth: number;
}

export function gordon(d1: number, ke: number, g: number): number | null {
  if (!isNum(d1) || d1 <= 0 || !isNum(ke) || ke <= g + 0.005) return null;
  return d1 / (ke - g);
}

export interface DdmResult {
  /** Dividendos previstos e o seu valor atual, ano a ano. */
  years: { year: number; dividend: number; presentValue: number }[];
  terminalValue: number;
  pvTerminal: number;
  value: number;
}

export function twoStageDdm(i: DdmInputs): DdmResult | null {
  if (!isNum(i.dividend) || i.dividend <= 0 || i.costOfEquity <= i.terminalGrowth + 0.005) {
    return null;
  }
  const years: DdmResult["years"] = [];
  let d = i.dividend;
  let pv = 0;
  for (let t = 1; t <= 5; t++) {
    d *= 1 + i.growth;
    const presentValue = d / (1 + i.costOfEquity) ** t;
    pv += presentValue;
    years.push({ year: t, dividend: d, presentValue });
  }
  const terminalValue = (d * (1 + i.terminalGrowth)) / (i.costOfEquity - i.terminalGrowth);
  const pvTerminal = terminalValue / (1 + i.costOfEquity) ** 5;
  return { years, terminalValue, pvTerminal, value: pv + pvTerminal };
}

export type ScenarioKey = "pessimista" | "normal" | "otimista";

export interface DdmScenario {
  key: ScenarioKey;
  growth: number;
  costOfEquity: number;
  value: number | null;
}

/** Três cenários: crescimento ±2 pp e custo do capital +1 pp / −0,5 pp. */
export function ddmScenarios(i: DdmInputs): DdmScenario[] {
  const defs: Array<[ScenarioKey, number, number]> = [
    ["pessimista", -0.02, 0.01],
    ["normal", 0, 0],
    ["otimista", 0.02, -0.005],
  ];
  return defs.map(([key, dg, dk]) => {
    const growth = Math.max(-0.05, i.growth + dg);
    const costOfEquity = i.costOfEquity + dk;
    return {
      key,
      growth,
      costOfEquity,
      value: twoStageDdm({ ...i, growth, costOfEquity })?.value ?? null,
    };
  });
}

export interface PvgoResult {
  /** Valor sem crescimento: EPS / kₑ. */
  noGrowthValue: number;
  pvgo: number;
  /** PVGO em fração do preço. */
  share: number;
}

export function pvgo(price: number, eps: number | null, ke: number): PvgoResult | null {
  if (!isNum(price) || price <= 0 || !isNum(eps) || !isNum(ke) || ke <= 0) return null;
  const noGrowthValue = eps / ke;
  const value = price - noGrowthValue;
  return { noGrowthValue, pvgo: value, share: value / price };
}
