/**
 * Pressupostos da avaliação, derivados dos dados e explicados um a um.
 * O utilizador pode alterar qualquer um na página; o motor volta a correr no browser.
 */

import { formatNumber, formatPct } from "@/lib/format";
import type { ProfileType } from "@/lib/valuation/classify";
import {
  countryRisk,
  mapIndustry,
  syntheticRating,
  type CountryRisk,
  type IndustryMatch,
  type SyntheticRating,
} from "@/lib/valuation/damodaran";
import { MATURE_MARKET_ERP } from "@/lib/valuation/damodaran-data";
import { investedCapitalSeries } from "@/lib/valuation/economic-profit";
import { reitReference } from "@/lib/valuation/reit";
import { at, avgLast, clamp, isNum, median, safeDiv, seriesCagr } from "@/lib/valuation/stats";
import type { CompanyData } from "@/lib/valuation/types";
import { releverBeta } from "@/lib/valuation/wacc";

export interface Assumptions {
  riskFree: number;
  matureErp: number;
  crp: number;
  beta: number;
  preTaxCostOfDebt: number;
  marginalTax: number;
  effectiveTax: number;
  /** Crescimento da receita nos anos 1–5 (cenário base). */
  growth: number;
  /** Margem operacional no ano 10 (cenário base). */
  targetMargin: number;
  terminalGrowth: number;
  salesToCapital: number;
  dividendGrowth: number;
  capRate: number;
  pAffoTarget: number;
  maintenanceCapexPct: number;
}

export type AssumptionKey = keyof Assumptions;

export const ASSUMPTION_LABELS: Record<AssumptionKey, string> = {
  riskFree: "Taxa sem risco (10 anos)",
  matureErp: "Prémio de risco do mercado (ERP)",
  crp: "Prémio de risco do país (CRP)",
  beta: "Beta",
  preTaxCostOfDebt: "Custo da dívida (antes de impostos)",
  marginalTax: "Taxa de imposto marginal",
  effectiveTax: "Taxa de imposto efetiva",
  growth: "Crescimento da receita (anos 1–5)",
  targetMargin: "Margem operacional no ano 10",
  terminalGrowth: "Crescimento perpétuo",
  salesToCapital: "Vendas / capital investido",
  dividendGrowth: "Crescimento dos dividendos (anos 1–5)",
  capRate: "Cap rate de mercado",
  pAffoTarget: "P/AFFO de referência",
  maintenanceCapexPct: "Capex de manutenção (% das amortizações)",
};

/** Pressupostos que se mostram em percentagem. */
export const PERCENT_ASSUMPTIONS = new Set<AssumptionKey>([
  "riskFree",
  "matureErp",
  "crp",
  "preTaxCostOfDebt",
  "marginalTax",
  "effectiveTax",
  "growth",
  "targetMargin",
  "terminalGrowth",
  "dividendGrowth",
  "capRate",
  "maintenanceCapexPct",
]);

export interface AssumptionContext {
  industry: IndustryMatch;
  country: CountryRisk;
  rating: SyntheticRating;
  betaRegression: number | null;
  betaBottomUp: number | null;
  betaChoice: "bottom-up" | "regressao" | "industria" | "omissao";
  debtToEquity: number;
  baseRevenue: number | null;
  baseRevenueSource: "12 meses" | "último ano" | null;
  baseEbit: number | null;
  baseMargin: number | null;
  historicalMargin: number | null;
  growthInputs: {
    historical: number | null;
    analystsCurrent: number | null;
    analystsNext: number | null;
    industry: number | null;
  };
  dividendGrowthInputs: {
    history: number | null;
    sustainable: number | null;
    analysts: number | null;
  };
  investedCapital: number | null;
  payout: number | null;
}

export type AssumptionNotes = Record<AssumptionKey, string>;

const pct = (v: number | null | undefined) => (isNum(v) ? formatPct(v * 100) : "—");

export function deriveAssumptions(
  data: CompanyData,
  profile: ProfileType,
): { assumptions: Assumptions; context: AssumptionContext; notes: AssumptionNotes } {
  const s = data.statements;
  const m = data.market;
  const industry = mapIndustry(data.profile.sector, data.profile.industry);
  const country = countryRisk(data.profile.country);
  const riskFree = isNum(data.macro.riskFree) ? data.macro.riskFree : 0.04;
  const marginalTax = country.taxRate ?? industry.industry.taxRate ?? 0.25;

  // Ano base: últimos 12 meses quando existem, senão o último ano fiscal.
  const ttmRevenue = data.trailing.revenue;
  const baseRevenue = isNum(ttmRevenue) && ttmRevenue > 0 ? ttmRevenue : at(s.revenue);
  const baseRevenueSource =
    isNum(ttmRevenue) && ttmRevenue > 0 ? "12 meses" : isNum(baseRevenue) ? "último ano" : null;
  const baseEbit =
    baseRevenueSource === "12 meses" && isNum(data.trailing.operatingIncome)
      ? data.trailing.operatingIncome
      : at(s.operatingIncome);
  const baseMargin = safeDiv(baseEbit, baseRevenue);
  const margins = s.revenue.map((r, i) => safeDiv(s.operatingIncome[i], r));
  const historicalMargin = avgLast(margins, 3);

  // Beta: bottom-up (indústria, ajustado à dívida da empresa) ou regressão.
  const debt = at(s.totalDebt) ?? 0;
  const debtToEquity = m.marketCap > 0 ? debt / m.marketCap : 0;
  const betaRegression = isNum(m.beta) ? m.beta : null;
  const unlev = industry.industry.unleveredBeta;
  const betaBottomUp = isNum(unlev) ? releverBeta(unlev, debtToEquity, marginalTax) : null;
  let beta: number;
  let betaChoice: AssumptionContext["betaChoice"];
  if (profile === "financeira") {
    const b = industry.industry.beta ?? betaRegression;
    beta = b ?? 1;
    betaChoice =
      industry.industry.beta != null
        ? "industria"
        : betaRegression != null
          ? "regressao"
          : "omissao";
  } else if (industry.match === "industria" && isNum(betaBottomUp)) {
    beta = betaBottomUp;
    betaChoice = "bottom-up";
  } else if (isNum(betaRegression)) {
    beta = betaRegression;
    betaChoice = "regressao";
  } else if (isNum(betaBottomUp)) {
    beta = betaBottomUp;
    betaChoice = "bottom-up";
  } else {
    beta = 1;
    betaChoice = "omissao";
  }
  beta = clamp(beta, 0.4, 2.5);

  // Custo da dívida: rating sintético + spread do país (fora dos EUA).
  const rating = syntheticRating(
    at(s.operatingIncome),
    at(s.interestExpense),
    profile === "financeira",
  );
  const countrySpread =
    country.found && country.country !== "United States" ? country.defaultSpread : 0;
  const preTaxCostOfDebt = riskFree + rating.spread + countrySpread;

  // Imposto efetivo: média dos últimos 3 anos com lucro antes de impostos.
  const taxRates = s.periods.map((_, i) => {
    const p = s.pretaxIncome[i];
    return isNum(p) && p > 0 ? safeDiv(s.taxProvision[i], p) : null;
  });
  const avgTax = avgLast(taxRates, 3);
  const effectiveTax = isNum(avgTax) ? clamp(avgTax, 0, marginalTax + 0.05) : marginalTax;

  // Crescimento da receita.
  const historical = seriesCagr(s.revenue);
  const analystsCurrent = data.analysts.revenueGrowthCurrentYear;
  const analystsNext = data.analysts.revenueGrowthNextYear;
  const analystVals = [analystsCurrent, analystsNext].filter(isNum);
  const analystAvg = analystVals.length
    ? analystVals.reduce((a, b) => a + b, 0) / analystVals.length
    : null;
  let growth: number;
  if (isNum(analystAvg) && isNum(historical)) growth = 0.6 * analystAvg + 0.4 * historical;
  else if (isNum(analystAvg)) growth = analystAvg;
  else if (isNum(historical)) growth = historical;
  else if (isNum(industry.industry.growth5y)) growth = industry.industry.growth5y * 0.5;
  else growth = 0.04;
  growth = clamp(growth, -0.05, 0.35);
  if (profile === "ciclica") growth = Math.min(growth, 0.08);

  // Margem-alvo.
  const indMargin = industry.industry.operatingMargin;
  let targetMargin: number;
  if (profile === "crescimento") {
    targetMargin =
      !isNum(baseMargin) || baseMargin <= 0
        ? (indMargin ?? 0.1)
        : isNum(indMargin) && baseMargin < indMargin
          ? indMargin
          : baseMargin;
  } else if (isNum(historicalMargin) && historicalMargin > 0) {
    targetMargin = historicalMargin;
  } else {
    targetMargin = indMargin ?? (isNum(baseMargin) ? baseMargin : 0.1);
  }
  targetMargin = clamp(targetMargin, -0.1, 0.6);

  const terminalGrowth = clamp(Math.min(riskFree, 0.025), 0.01, 0.03);

  const ic = at(investedCapitalSeries(s));
  const s2c = safeDiv(baseRevenue, ic);
  const salesToCapital = isNum(s2c) && s2c > 0 ? clamp(s2c, 0.5, 4) : 1.5;

  // Crescimento dos dividendos.
  const dps = s.periods.map((_, i) =>
    safeDiv(
      Math.abs(s.dividendsPaid[i] ?? 0) || null,
      s.dilutedShares[i] ?? s.sharesOutstanding[i],
    ),
  );
  const history = seriesCagr(dps);
  const ni = at(s.netIncome);
  const divPaid = Math.abs(at(s.dividendsPaid) ?? 0);
  const payout = isNum(ni) && ni > 0 && divPaid > 0 ? clamp(divPaid / ni, 0, 1.5) : m.payoutRatio;
  const eq = at(s.equity);
  const roe = isNum(ni) && isNum(eq) && eq > 0 ? ni / eq : null;
  const sustainable =
    isNum(roe) && isNum(payout) ? clamp(roe * (1 - Math.min(payout, 1)), -0.05, 0.25) : null;
  const analystsEps = data.analysts.epsGrowthNextYear;
  const dg = median([history, sustainable, analystsEps].filter(isNum) as number[]);
  const dividendGrowth = clamp(isNum(dg) ? dg : 0.03, 0, 0.1);

  const ref = reitReference(data.profile.industry);

  const assumptions: Assumptions = {
    riskFree,
    matureErp: MATURE_MARKET_ERP,
    crp: country.crp,
    beta,
    preTaxCostOfDebt,
    marginalTax,
    effectiveTax,
    growth,
    targetMargin,
    terminalGrowth,
    salesToCapital,
    dividendGrowth,
    capRate: ref.capRate,
    pAffoTarget: ref.pAffo,
    maintenanceCapexPct: 0.1,
  };

  const betaText =
    betaChoice === "bottom-up"
      ? `Beta da indústria «${industry.industry.name}» sem dívida (${formatNumber(unlev ?? 0, 2)}), ajustado à dívida da empresa (D/E ${pct(debtToEquity)}). A regressão do Yahoo dá ${isNum(betaRegression) ? formatNumber(betaRegression, 2) : "—"}.`
      : betaChoice === "industria"
        ? `Beta médio da indústria «${industry.industry.name}» (nos bancos não se ajusta à dívida).`
        : betaChoice === "regressao"
          ? "Beta de regressão do Yahoo (5 anos, mensal): a indústria não se identificou com segurança."
          : "Sem beta disponível: usa-se 1 (o risco do mercado).";

  const notes: AssumptionNotes = {
    riskFree: `${data.macro.riskFreeLabel}. É o rendimento de uma aplicação sem risco na moeda da cotação.`,
    matureErp: `Prémio implícito do S&P 500 calculado pelo Damodaran (atualização de janeiro de 2026).`,
    crp: country.found
      ? `${country.country}: rating ${country.rating ?? "sem rating"}, prémio do país ${pct(country.crp)} (Damodaran). Usa-se o país da sede como aproximação de onde a empresa opera.`
      : `País «${data.profile.country ?? "desconhecido"}» fora da tabela: assume-se um mercado maduro, sem prémio adicional.`,
    beta: betaText,
    preTaxCostOfDebt: `Taxa sem risco + spread do rating sintético ${rating.rating} (${pct(rating.spread)}, cobertura de juros ${isNum(rating.coverage) ? `${formatNumber(rating.coverage, 1)}×` : "sem juros relevantes"})${countrySpread > 0 ? ` + spread do país (${pct(countrySpread)})` : ""}.`,
    marginalTax:
      country.taxRate != null
        ? `IRC marginal de ${country.country} (Damodaran).`
        : "Taxa típica de 25 %.",
    effectiveTax: isNum(avgTax)
      ? `Média dos últimos anos (imposto ÷ lucro antes de impostos): ${pct(avgTax)}. No DCF converge para a marginal entre os anos 6 e 10.`
      : "Sem histórico de impostos: usa-se a marginal.",
    growth: `Combina a média dos analistas para este ano e o próximo (${pct(analystAvg)}) com o crescimento histórico da receita (${pct(historical)})${profile === "ciclica" ? "; numa cíclica limita-se a 8 %" : ""}. Entre os anos 6 e 10 desce até ao crescimento perpétuo.`,
    targetMargin:
      profile === "crescimento"
        ? `Empresa em crescimento: a margem converge para a de uma empresa madura do setor (${pct(indMargin)}, Damodaran) ou mantém a atual (${pct(baseMargin)}), a que for maior.`
        : `Média da margem operacional dos últimos 3 anos (${pct(historicalMargin)}); a margem atual é ${pct(baseMargin)} e a do setor ${pct(indMargin)}.`,
    terminalGrowth:
      "Depois do ano 10, a empresa cresce como a economia: nunca acima da taxa sem risco (no máximo 2,5 %).",
    salesToCapital: isNum(s2c)
      ? `Receita ÷ capital investido (${formatNumber(s2c, 2)}): por cada euro de receita nova, investe-se 1/${formatNumber(salesToCapital, 2)} em capital.`
      : "Sem capital investido calculável: usa-se 1,5.",
    dividendGrowth: `Mediana entre o crescimento histórico do dividendo por ação (${pct(history)}), o sustentável ROE × (1 − payout) (${pct(sustainable)}) e o esperado para os lucros (${pct(analystsEps)}), entre 0 % e 10 %.`,
    capRate: `Cap rate típica do segmento «${ref.label}» (referência indicativa: confirma com transações recentes).`,
    pAffoTarget: `P/AFFO típico do segmento «${ref.label}» (referência indicativa).`,
    maintenanceCapexPct:
      "As contas não separam o capex de manutenção: estima-se em 10 % das amortizações. Confirma o AFFO no relatório do REIT.",
  };

  return {
    assumptions,
    notes,
    context: {
      industry,
      country,
      rating,
      betaRegression,
      betaBottomUp,
      betaChoice,
      debtToEquity,
      baseRevenue,
      baseRevenueSource,
      baseEbit,
      baseMargin,
      historicalMargin,
      growthInputs: {
        historical,
        analystsCurrent,
        analystsNext,
        industry: industry.industry.growth5y,
      },
      dividendGrowthInputs: { history, sustainable, analysts: analystsEps },
      investedCapital: ic,
      payout: isNum(payout) ? payout : null,
    },
  };
}
