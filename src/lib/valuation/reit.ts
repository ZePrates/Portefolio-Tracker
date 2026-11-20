/**
 * Avaliação de REITs (sociedades de investimento imobiliário).
 *
 *   FFO  = resultado líquido + amortizações − mais-valias na venda de imóveis
 *   AFFO ≈ FFO − capex de manutenção (estimado em % das amortizações)
 *   NOI  ≈ EBITDA (rendas líquidas dos imóveis)
 *   Cap rate implícita = NOI / valor da empresa
 *   NAV  = NOI / cap rate de mercado − dívida líquida
 *
 * As contas públicas não trazem o capex de manutenção nem a ocupação: são
 * estimativas e devem ser confirmadas no relatório da empresa.
 */

import { at, cagr, clamp, isNum, safeDiv, span } from "@/lib/valuation/stats";
import type { AnnualStatements } from "@/lib/valuation/types";

export interface ReitReference {
  label: string;
  /** Cap rate típica do segmento. */
  capRate: number;
  /** P/AFFO típico do segmento. */
  pAffo: number;
}

/** Referências indicativas por segmento (editáveis na página). */
export const REIT_REFERENCES: ReadonlyArray<readonly [RegExp, ReitReference]> = [
  [/industrial/, { label: "Industrial e logística", capRate: 0.055, pAffo: 20 }],
  [/retail/, { label: "Retalho", capRate: 0.0675, pAffo: 14 }],
  [/residential/, { label: "Residencial", capRate: 0.0525, pAffo: 19 }],
  [/office/, { label: "Escritórios", capRate: 0.075, pAffo: 11 }],
  [/healthcare/, { label: "Saúde", capRate: 0.065, pAffo: 16 }],
  [/hotel|motel/, { label: "Hotelaria", capRate: 0.08, pAffo: 10 }],
  [/specialty/, { label: "Especializado (torres, centros de dados)", capRate: 0.0575, pAffo: 22 }],
  [/mortgage/, { label: "Crédito hipotecário", capRate: 0.07, pAffo: 9 }],
  [/diversified/, { label: "Diversificado", capRate: 0.0675, pAffo: 13 }],
];

export const DEFAULT_REIT_REFERENCE: ReitReference = { label: "REIT", capRate: 0.065, pAffo: 15 };

export function reitReference(industry: string | null): ReitReference {
  const ind = (industry ?? "").toLowerCase();
  return REIT_REFERENCES.find(([re]) => re.test(ind))?.[1] ?? DEFAULT_REIT_REFERENCE;
}

export interface ReitInputs {
  statements: AnnualStatements;
  price: number;
  shares: number;
  marketCap: number;
  dividendRate: number | null;
  capRate: number;
  pAffoTarget: number;
  /** Capex de manutenção em fração das amortizações. */
  maintenanceCapexPct: number;
  /**
   * Crescimento esperado da receita no ano em curso (analistas). Aplica-se ao
   * AFFO e ao NOI usados no valor justo: um REIT com ocupação a cair vale pelo
   * que vai render, não pelo que rendeu.
   */
  forwardGrowth: number | null;
}

export interface ReitAnalysis {
  /** Fator aplicado ao AFFO e ao NOI no valor justo (1 + crescimento esperado, limitado). */
  forwardFactor: number;
  ffo: number | null;
  /** AFFO usado: o menor entre o calculado pelo FFO e o calculado pela caixa operacional. */
  affo: number | null;
  /** FFO − capex de manutenção. */
  affoFromFfo: number | null;
  /** Fluxo de caixa operacional − capex de manutenção. */
  affoFromCash: number | null;
  affoSource: "ffo" | "caixa";
  ffoPerShare: number | null;
  affoPerShare: number | null;
  pFfo: number | null;
  pAffo: number | null;
  affoYield: number | null;
  affoPayout: number | null;
  noi: number | null;
  enterpriseValue: number;
  impliedCapRate: number | null;
  nav: number | null;
  navPerShare: number | null;
  /** Prémio (+) ou desconto (−) do preço face ao NAV. */
  premiumToNav: number | null;
  netDebtToEbitda: number | null;
  debtToAssets: number | null;
  interestCoverage: number | null;
  ffoGrowth: number | null;
  /** FFO por ação de cada ano. */
  ffoHistory: { period: string; ffoPerShare: number | null }[];
  /** Valor justo pelo P/AFFO de referência. */
  affoValue: number | null;
}

/**
 * FFO (definição da NAREIT): resultado líquido + amortizações + imparidades de
 * imóveis − mais-valias na venda de imóveis. As imparidades não saem da caixa.
 */
export function ffoOf(s: AnnualStatements, i: number): number | null {
  const ni = s.netIncome[i];
  const dep = s.depreciation[i];
  if (!isNum(ni) || !isNum(dep)) return null;
  return ni + Math.abs(dep) + Math.abs(s.impairments[i] ?? 0) - (s.gainOnSale[i] ?? 0);
}

export function analyzeReit(i: ReitInputs): ReitAnalysis {
  const s = i.statements;
  const n = s.periods.length;
  const ffo = n ? ffoOf(s, n - 1) : null;
  const dep = at(s.depreciation);
  const maintenance = i.maintenanceCapexPct * Math.abs(dep ?? 0);
  const affoFromFfo = isNum(ffo) ? ffo - maintenance : null;
  // Verificação pela caixa: o FFO volta a somar todas as imparidades (incluindo
  // as de investimentos que não são imóveis) e as rendas lineares que ainda não
  // entraram. O fluxo de caixa operacional não tem esses itens.
  const ocf = at(s.operatingCashFlow);
  const affoFromCash = isNum(ocf) ? ocf - maintenance : null;
  const useCash =
    isNum(affoFromCash) && affoFromCash > 0 && (!isNum(affoFromFfo) || affoFromCash < affoFromFfo);
  const affo = useCash ? affoFromCash : affoFromFfo;
  const ffoPerShare = safeDiv(ffo, i.shares);
  const affoPerShare = safeDiv(affo, i.shares);
  const debt = at(s.totalDebt) ?? 0;
  const cash = at(s.cash) ?? 0;
  const netDebt = debt - cash;
  // EBITDA normalizado (sem imparidades) aproxima melhor as rendas líquidas.
  const ebitda =
    at(s.normalizedEbitda) ??
    at(s.ebitda) ??
    (isNum(at(s.operatingIncome)) && isNum(dep) ? at(s.operatingIncome)! + Math.abs(dep) : null);
  const noi = ebitda;
  const forwardFactor = 1 + clamp(i.forwardGrowth ?? 0, -0.3, 0.15);
  const enterpriseValue = i.marketCap + netDebt + (at(s.minorityInterest) ?? 0);
  const nav =
    isNum(noi) && noi > 0 && i.capRate > 0 ? (noi * forwardFactor) / i.capRate - netDebt : null;
  const navPerShare = safeDiv(nav, i.shares);
  const dividends = isNum(i.dividendRate) ? i.dividendRate * i.shares : null;
  const sharesSeries = s.dilutedShares.some(isNum) ? s.dilutedShares : s.sharesOutstanding;
  const ffoHistory = s.periods.map((period, k) => ({
    period,
    ffoPerShare: safeDiv(ffoOf(s, k), sharesSeries[k] ?? null),
  }));
  const fs = span(ffoHistory.map((h) => h.ffoPerShare));
  const interest = at(s.interestExpense);
  return {
    forwardFactor,
    ffo,
    affo,
    affoFromFfo,
    affoFromCash,
    affoSource: useCash ? "caixa" : "ffo",
    ffoPerShare,
    affoPerShare,
    pFfo: isNum(ffoPerShare) && ffoPerShare > 0 ? i.price / ffoPerShare : null,
    pAffo: isNum(affoPerShare) && affoPerShare > 0 ? i.price / affoPerShare : null,
    affoYield: isNum(affoPerShare) ? affoPerShare / i.price : null,
    affoPayout: isNum(dividends) && isNum(affo) && affo > 0 ? dividends / affo : null,
    noi,
    enterpriseValue,
    impliedCapRate: isNum(noi) && enterpriseValue > 0 ? noi / enterpriseValue : null,
    nav,
    navPerShare,
    premiumToNav: isNum(navPerShare) && navPerShare > 0 ? i.price / navPerShare - 1 : null,
    netDebtToEbitda: isNum(ebitda) && ebitda > 0 ? netDebt / ebitda : null,
    debtToAssets: safeDiv(debt, at(s.totalAssets)),
    interestCoverage:
      isNum(ebitda) && isNum(interest) && Math.abs(interest) > 0
        ? ebitda / Math.abs(interest)
        : null,
    ffoGrowth: fs ? cagr(fs.first, fs.last, fs.years) : null,
    ffoHistory,
    affoValue:
      isNum(affoPerShare) && affoPerShare > 0 ? affoPerShare * forwardFactor * i.pAffoTarget : null,
  };
}

export interface ReitScore {
  /** 0 a 10. */
  score: number | null;
  parts: { label: string; points: number; max: number }[];
}

/** Nota de 0 a 10: valorização, segurança do dividendo, dívida, juros e crescimento do FFO. */
export function reitScore(r: ReitAnalysis, upside: number | null): ReitScore {
  const parts: ReitScore["parts"] = [];
  if (isNum(upside)) {
    parts.push({
      label: "Valorização (potencial face ao valor justo)",
      points: upside >= 0.2 ? 2.5 : upside >= 0.05 ? 1.75 : upside >= -0.1 ? 1 : 0,
      max: 2.5,
    });
  }
  if (isNum(r.affoPayout)) {
    const p = r.affoPayout;
    parts.push({
      label: "Segurança do dividendo (payout do AFFO)",
      points: p <= 0.75 ? 2.5 : p <= 0.85 ? 1.75 : p <= 1 ? 0.75 : 0,
      max: 2.5,
    });
  }
  if (isNum(r.netDebtToEbitda)) {
    const d = r.netDebtToEbitda;
    parts.push({
      label: "Dívida (dívida líquida / EBITDA)",
      points: d <= 5 ? 2.5 : d <= 6.5 ? 1.75 : d <= 8 ? 0.75 : 0,
      max: 2.5,
    });
  }
  if (isNum(r.interestCoverage)) {
    const c = r.interestCoverage;
    parts.push({
      label: "Cobertura dos juros (EBITDA / juros)",
      points: c >= 4 ? 1.5 : c >= 2.5 ? 1 : 0.25,
      max: 1.5,
    });
  }
  if (isNum(r.ffoGrowth)) {
    const g = r.ffoGrowth;
    parts.push({
      label: "Crescimento do FFO por ação",
      points: g >= 0.04 ? 1 : g >= 0 ? 0.5 : 0,
      max: 1,
    });
  }
  const max = parts.reduce((a, p) => a + p.max, 0);
  const got = parts.reduce((a, p) => a + p.points, 0);
  return { score: max >= 4 ? (got / max) * 10 : null, parts };
}
