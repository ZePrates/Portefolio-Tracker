/**
 * DCF por fluxos de caixa livres para a empresa (FCFF), em duas fases, ao
 * estilo do Damodaran:
 *
 * - Anos 1–5: a receita cresce à taxa da fase de crescimento.
 * - Anos 6–10: o crescimento desce em linha reta até ao crescimento perpétuo.
 * - A margem operacional converge da atual para a margem-alvo até ao ano 10.
 * - O imposto passa da taxa efetiva para a marginal entre os anos 6 e 10.
 * - Reinvestimento = Δ receita / (vendas ÷ capital investido).
 * - Valor terminal (Gordon) no ano 10: FCFF₁₁ / (WACC − g), com o
 *   reinvestimento do ano 11 = g / ROIC terminal.
 *
 *   FCFF = EBIT × (1 − t) − reinvestimento
 *   Valor da empresa = Σ FCFF / (1 + WACC)^t + VT / (1 + WACC)^10
 *   Capital próprio = Valor da empresa + caixa − dívida − interesses minoritários
 */

import { clamp, isNum, normalSample, quantile, seededRandom } from "@/lib/valuation/stats";

export interface DcfInputs {
  /** Receita do ano base (últimos 12 meses ou último ano fiscal). */
  revenue: number;
  /** Margem operacional (EBIT / receita) do ano base. */
  margin: number;
  /** Margem operacional no ano 10. */
  targetMargin: number;
  /** Crescimento anual da receita nos anos 1–5. */
  growth: number;
  /** Crescimento perpétuo depois do ano 10. */
  terminalGrowth: number;
  wacc: number;
  taxEffective: number;
  taxMarginal: number;
  /** Receita gerada por cada unidade de capital investido. */
  salesToCapital: number;
  /** Retorno sobre o capital investido na perpetuidade. */
  terminalRoic: number;
  cash: number;
  debt: number;
  minorityInterest: number;
  shares: number;
}

export interface DcfYear {
  year: number;
  growth: number;
  revenue: number;
  margin: number;
  ebit: number;
  taxRate: number;
  nopat: number;
  reinvestment: number;
  fcff: number;
  discountFactor: number;
  presentValue: number;
}

export interface DcfResult {
  years: DcfYear[];
  terminalFcff: number;
  terminalValue: number;
  pvTerminal: number;
  pvExplicit: number;
  enterpriseValue: number;
  equityValue: number;
  perShare: number;
  /** Peso do valor terminal no valor da empresa. */
  terminalShare: number;
}

const HORIZON = 10;
const HIGH_GROWTH_YEARS = 5;

export function runDcf(i: DcfInputs): DcfResult | null {
  if (
    !isNum(i.revenue) ||
    i.revenue <= 0 ||
    !isNum(i.shares) ||
    i.shares <= 0 ||
    !isNum(i.wacc) ||
    i.wacc <= i.terminalGrowth + 0.005
  ) {
    return null;
  }
  const s2c = i.salesToCapital > 0 ? i.salesToCapital : 1.5;
  const years: DcfYear[] = [];
  let prevRevenue = i.revenue;
  let pvExplicit = 0;
  for (let t = 1; t <= HORIZON; t++) {
    const growth =
      t <= HIGH_GROWTH_YEARS
        ? i.growth
        : i.growth - ((i.growth - i.terminalGrowth) * (t - HIGH_GROWTH_YEARS)) / HIGH_GROWTH_YEARS;
    const revenue = prevRevenue * (1 + growth);
    const margin = i.margin + ((i.targetMargin - i.margin) * t) / HORIZON;
    const ebit = revenue * margin;
    const taxRate =
      t <= HIGH_GROWTH_YEARS
        ? i.taxEffective
        : i.taxEffective +
          ((i.taxMarginal - i.taxEffective) * (t - HIGH_GROWTH_YEARS)) / HIGH_GROWTH_YEARS;
    const nopat = ebit > 0 ? ebit * (1 - taxRate) : ebit;
    const reinvestment = (revenue - prevRevenue) / s2c;
    const fcff = nopat - reinvestment;
    const discountFactor = 1 / (1 + i.wacc) ** t;
    const presentValue = fcff * discountFactor;
    pvExplicit += presentValue;
    years.push({
      year: t,
      growth,
      revenue,
      margin,
      ebit,
      taxRate,
      nopat,
      reinvestment,
      fcff,
      discountFactor,
      presentValue,
    });
    prevRevenue = revenue;
  }
  const last = years[years.length - 1]!;
  const g = i.terminalGrowth;
  const roic = i.terminalRoic > g ? i.terminalRoic : Math.max(i.wacc, g + 0.01);
  const ebit11 = last.revenue * (1 + g) * i.targetMargin;
  const nopat11 = ebit11 > 0 ? ebit11 * (1 - i.taxMarginal) : ebit11;
  const terminalFcff = nopat11 * (1 - g / roic);
  const terminalValue = terminalFcff / (i.wacc - g);
  const pvTerminal = terminalValue * last.discountFactor;
  const enterpriseValue = pvExplicit + pvTerminal;
  const equityValue = enterpriseValue + i.cash - i.debt - i.minorityInterest;
  return {
    years,
    terminalFcff,
    terminalValue,
    pvTerminal,
    pvExplicit,
    enterpriseValue,
    equityValue,
    perShare: equityValue / i.shares,
    terminalShare: enterpriseValue !== 0 ? pvTerminal / enterpriseValue : 0,
  };
}

/** Valor por ação (ou null). */
export function dcfValue(i: DcfInputs): number | null {
  const r = runDcf(i);
  return r && isNum(r.perShare) ? r.perShare : null;
}

/**
 * DCF invertido: crescimento da receita nos anos 1–5 que o preço atual implica,
 * mantendo os restantes pressupostos. null se não houver solução entre −30 % e 80 %.
 */
export function impliedGrowth(i: DcfInputs, price: number): number | null {
  if (!isNum(price) || price <= 0) return null;
  const f = (g: number) => (dcfValue({ ...i, growth: g }) ?? NaN) - price;
  let lo = -0.3;
  let hi = 0.8;
  let flo = f(lo);
  const fhi = f(hi);
  if (!isNum(flo) || !isNum(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (!isNum(fm)) return null;
    if (Math.abs(fm) < 1e-6 * price) return mid;
    if (flo * fm <= 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

export interface SensitivityGrid {
  waccs: number[];
  growths: number[];
  /** values[iWacc][iGrowth] = valor por ação. */
  values: (number | null)[][];
}

/** Tabela de sensibilidade WACC × crescimento perpétuo. */
export function sensitivity(
  i: DcfInputs,
  waccSteps = [-0.02, -0.01, 0, 0.01, 0.02],
  growthSteps = [-0.01, -0.005, 0, 0.005, 0.01],
): SensitivityGrid {
  const waccs = waccSteps.map((d) => i.wacc + d);
  const growths = growthSteps.map((d) => i.terminalGrowth + d);
  const values = waccs.map((w) =>
    growths.map((g) => (w > g + 0.005 ? dcfValue({ ...i, wacc: w, terminalGrowth: g }) : null)),
  );
  return { waccs, growths, values };
}

export interface MonteCarloResult {
  runs: number;
  p10: number;
  p50: number;
  p90: number;
  /** Probabilidade de o valor justo ficar acima do preço atual. */
  probAbovePrice: number | null;
  /** Histograma: limites inferiores e contagens. */
  bins: { from: number; to: number; count: number }[];
}

/**
 * Simulação de Monte Carlo do DCF: o crescimento, a margem-alvo, o WACC e o
 * crescimento perpétuo variam à volta do cenário base. Semente fixa, para o
 * resultado ser sempre o mesmo com os mesmos dados.
 */
export function monteCarlo(
  i: DcfInputs,
  price: number | null,
  runs = 2000,
  seed = 20260101,
): MonteCarloResult | null {
  const rand = seededRandom(seed);
  const values: number[] = [];
  const growthSd = Math.max(0.02, Math.abs(i.growth) * 0.35);
  const marginSd = Math.max(0.01, Math.abs(i.targetMargin) * 0.15);
  for (let k = 0; k < runs; k++) {
    const growth = clamp(i.growth + normalSample(rand) * growthSd, -0.2, 0.6);
    const targetMargin = clamp(i.targetMargin + normalSample(rand) * marginSd, -0.2, 0.7);
    const wacc = clamp(i.wacc + normalSample(rand) * 0.01, 0.04, 0.2);
    const terminalGrowth = clamp(i.terminalGrowth + (rand() - 0.5) * 0.01, 0, wacc - 0.01);
    const v = dcfValue({ ...i, growth, targetMargin, wacc, terminalGrowth });
    if (isNum(v)) values.push(v);
  }
  if (values.length < runs * 0.5) return null;
  values.sort((a, b) => a - b);
  const p10 = quantile(values, 0.1)!;
  const p50 = quantile(values, 0.5)!;
  const p90 = quantile(values, 0.9)!;
  const lo = quantile(values, 0.02)!;
  const hi = quantile(values, 0.98)!;
  const nBins = 20;
  const width = (hi - lo) / nBins || 1;
  const bins = Array.from({ length: nBins }, (_, b) => ({
    from: lo + b * width,
    to: lo + (b + 1) * width,
    count: 0,
  }));
  for (const v of values) {
    if (v < lo || v > hi) continue;
    const b = Math.min(nBins - 1, Math.floor((v - lo) / width));
    bins[b]!.count++;
  }
  const probAbovePrice =
    isNum(price) && price > 0 ? values.filter((v) => v > price).length / values.length : null;
  return { runs: values.length, p10, p50, p90, probAbovePrice, bins };
}
