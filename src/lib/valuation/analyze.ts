/**
 * Avaliação completa de uma empresa: corre todos os modelos com os
 * pressupostos (os derivados dos dados ou os alterados pelo utilizador),
 * pondera o valor justo conforme o tipo de empresa e junta os alertas.
 */

import {
  deriveAssumptions,
  type AssumptionContext,
  type AssumptionNotes,
  type Assumptions,
} from "@/lib/valuation/assumptions";
import { formatMoney } from "@/lib/format";
import { classifyCompany, type Classification, type ProfileType } from "@/lib/valuation/classify";
import {
  impliedGrowth,
  monteCarlo,
  runDcf,
  sensitivity,
  type DcfInputs,
  type DcfResult,
  type MonteCarloResult,
  type SensitivityGrid,
} from "@/lib/valuation/dcf";
import {
  ddmScenarios,
  gordon,
  pvgo,
  twoStageDdm,
  type DdmResult,
  type DdmScenario,
  type PvgoResult,
} from "@/lib/valuation/ddm";
import {
  evaHistory,
  evaValuation,
  investedCapitalSeries,
  valueCreation,
  type EvaValuation,
  type EvaYear,
  type ValueCreation,
} from "@/lib/valuation/economic-profit";
import { averageRoe, bankValuation, type BankValuation } from "@/lib/valuation/financials";
import {
  altman,
  beneish,
  dupont,
  financialBalance,
  healthScore,
  isManufacturing,
  piotroskiHistory,
  qualityMetrics,
  type AltmanResult,
  type BalanceAnalysis,
  type BeneishResult,
  type DupontResult,
  type HealthScore,
  type PiotroskiResult,
  type QualityMetrics,
} from "@/lib/valuation/health";
import { fedModel, yardeni, type FedModelResult, type YardeniResult } from "@/lib/valuation/macro";
import { AAA_SPREAD, marketAggregate } from "@/lib/valuation/damodaran";
import {
  capitalAllocation,
  executionRecord,
  insiderSignal,
  managementScore,
  type CapitalAllocation,
  type ExecutionRecord,
  type InsiderSignal,
  type ManagementScore,
} from "@/lib/valuation/management";
import {
  multiplesValuation,
  type MultipleInputs,
  type MultiplesResult,
} from "@/lib/valuation/multiples";
import {
  analyzeReit,
  reitReference,
  reitScore,
  type ReitAnalysis,
  type ReitReference,
  type ReitScore,
} from "@/lib/valuation/reit";
import { at, clamp, isNum, median, safeDiv } from "@/lib/valuation/stats";
import type { CompanyData } from "@/lib/valuation/types";
import { computeWacc, type WaccResult } from "@/lib/valuation/wacc";

export type ScenarioKey = "pessimista" | "base" | "otimista";

export const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  pessimista: "Pessimista",
  base: "Base",
  otimista: "Otimista",
};

/** Peso de cada cenário no valor do DCF. */
export const SCENARIO_WEIGHTS: Record<ScenarioKey, number> = {
  pessimista: 0.25,
  base: 0.5,
  otimista: 0.25,
};

export type ModelKey =
  "dcf" | "multiplos" | "ddm" | "eva" | "pvc" | "retorno_excesso" | "affo" | "nav";

export const MODEL_LABELS: Record<ModelKey, string> = {
  dcf: "DCF (fluxos de caixa descontados)",
  multiplos: "Múltiplos dos pares",
  ddm: "Dividendos (DDM)",
  eva: "Lucro económico (EVA)",
  pvc: "P/VC justificado",
  retorno_excesso: "Retorno em excesso",
  affo: "P/AFFO",
  nav: "Valor dos imóveis (NAV)",
};

/** Peso base de cada modelo por tipo de empresa (antes de excluir os que não se aplicam). */
export const MODEL_WEIGHTS: Record<ProfileType, Partial<Record<ModelKey, number>>> = {
  madura: { dcf: 0.35, multiplos: 0.3, eva: 0.2, ddm: 0.15 },
  crescimento: { dcf: 0.5, multiplos: 0.35, eva: 0.15 },
  ciclica: { dcf: 0.3, multiplos: 0.45, eva: 0.15, ddm: 0.1 },
  financeira: { pvc: 0.3, retorno_excesso: 0.25, multiplos: 0.25, ddm: 0.2 },
  reit: { affo: 0.35, nav: 0.3, ddm: 0.2, multiplos: 0.15 },
};

export interface ModelValue {
  key: ModelKey;
  label: string;
  value: number | null;
  baseWeight: number;
  /** Peso final no valor justo (0 se ficou de fora). */
  weight: number;
  included: boolean;
  reason: string | null;
}

export type FlagKind =
  | "especulativa"
  | "prejuizo"
  | "quebra"
  | "armadilha"
  | "discordantes"
  | "afastado"
  | "holding"
  | "moeda"
  | "historico"
  | "analistas";

export interface Flag {
  kind: FlagKind;
  severity: "info" | "aviso";
  text: string;
}

export type Verdict = "subavaliada" | "justa" | "sobreavaliada";

export const VERDICT_LABELS: Record<Verdict, string> = {
  subavaliada: "Abaixo do valor justo",
  justa: "Perto do valor justo",
  sobreavaliada: "Acima do valor justo",
};

export interface Composite {
  models: ModelValue[];
  fairValue: number | null;
  low: number | null;
  high: number | null;
  /** Potencial = valor justo / preço − 1. */
  upside: number | null;
  verdict: Verdict | null;
  /** Valor justo / alvo médio dos analistas − 1. */
  analystGap: number | null;
  /**
   * false quando um alerta põe o potencial em causa (especulativa, armadilha de
   * valor, modelos discordantes, cisão, dados suspeitos): a nota trata-o como neutro.
   */
  reliable: boolean;
}

/** Alertas que tornam o potencial pouco fiável. */
const UNRELIABLE_FLAGS: ReadonlySet<FlagKind> = new Set<FlagKind>([
  "especulativa",
  "armadilha",
  "discordantes",
  "quebra",
  "afastado",
]);

export interface ScoreBreakdown {
  total: number | null;
  parts: { label: string; value: number | null; weight: number }[];
}

export interface PriceStats {
  change12m: number | null;
  fromHigh: number | null;
  /** Maior queda numa semana (5 sessões) nos últimos 12 meses. */
  worstWeek: { drop: number; date: string } | null;
}

export interface CompanyAnalysis {
  classification: Classification;
  assumptions: Assumptions;
  defaults: Assumptions;
  context: AssumptionContext;
  notes: AssumptionNotes;
  wacc: WaccResult;
  dcf: {
    applicable: boolean;
    reason: string | null;
    scenarios: Record<ScenarioKey, { inputs: DcfInputs; result: DcfResult | null }>;
    value: number | null;
    impliedGrowth: number | null;
    sensitivity: SensitivityGrid | null;
    monteCarlo: MonteCarloResult | null;
  };
  multiples: { inputs: MultipleInputs; result: MultiplesResult };
  ddm: {
    applicable: boolean;
    reason: string | null;
    dividend: number | null;
    gordonValue: number | null;
    twoStage: DdmResult | null;
    scenarios: DdmScenario[];
    value: number | null;
    pvgo: PvgoResult | null;
  };
  eva: {
    history: EvaYear[];
    valuation: EvaValuation | null;
    creation: ValueCreation;
    /** Capital investido ÷ valor de mercado da empresa. */
    capitalIntensity: number | null;
  };
  bank: BankValuation | null;
  reit: { reference: ReitReference; analysis: ReitAnalysis; score: ReitScore } | null;
  health: {
    altman: AltmanResult | null;
    altmanApplicable: boolean;
    piotroski: PiotroskiResult[];
    beneish: BeneishResult | null;
    quality: QualityMetrics;
    dupont: DupontResult;
    balance: BalanceAnalysis | null;
    score: HealthScore;
  };
  management: {
    allocation: CapitalAllocation;
    execution: ExecutionRecord;
    insiders: InsiderSignal;
    score: ManagementScore;
  };
  macro: {
    fed: FedModelResult | null;
    yardeni: YardeniResult | null;
    corporateBondYield: number | null;
    longTermGrowth: number;
  };
  composite: Composite;
  flags: Flag[];
  priceStats: PriceStats;
  score: ScoreBreakdown;
}

function priceStats(data: CompanyData): PriceStats {
  const h = data.priceHistory;
  if (h.length < 10) return { change12m: null, fromHigh: null, worstWeek: null };
  const first = h[0]!.close;
  const last = h[h.length - 1]!.close;
  const high = Math.max(...h.map((p) => p.close));
  let worst: PriceStats["worstWeek"] = null;
  for (let i = 5; i < h.length; i++) {
    const drop = h[i]!.close / h[i - 5]!.close - 1;
    if (!worst || drop < worst.drop) worst = { drop, date: h[i]!.date };
  }
  return { change12m: last / first - 1, fromHigh: last / high - 1, worstWeek: worst };
}

function dcfInputsFor(
  data: CompanyData,
  a: Assumptions,
  ctx: AssumptionContext,
  wacc: number,
  roic: number | null,
  scenario: ScenarioKey,
): DcfInputs {
  const s = data.statements;
  const baseGrowth = a.growth;
  const baseMargin = isNum(ctx.baseMargin) ? ctx.baseMargin : a.targetMargin;
  const spread = isNum(roic) ? Math.max(0, Math.min(roic, 0.4) - wacc) : 0;
  const common = {
    revenue: ctx.baseRevenue ?? 0,
    margin: baseMargin,
    wacc,
    taxEffective: a.effectiveTax,
    taxMarginal: a.marginalTax,
    salesToCapital: a.salesToCapital,
    cash: at(s.cash) ?? 0,
    debt: at(s.totalDebt) ?? 0,
    minorityInterest: at(s.minorityInterest) ?? 0,
    shares: data.market.shares,
  };
  if (scenario === "pessimista") {
    return {
      ...common,
      growth: Math.max(-0.08, baseGrowth * 0.5 - 0.02),
      targetMargin: a.targetMargin * (a.targetMargin > 0 ? 0.85 : 1.15),
      terminalGrowth: Math.max(0.005, a.terminalGrowth - 0.005),
      terminalRoic: wacc,
    };
  }
  if (scenario === "otimista") {
    return {
      ...common,
      growth: Math.min(0.5, baseGrowth * 1.3 + 0.01),
      targetMargin: Math.min(0.6, a.targetMargin * (a.targetMargin > 0 ? 1.1 : 0.85)),
      terminalGrowth: Math.min(a.terminalGrowth + 0.005, Math.max(a.riskFree, 0.01), 0.035),
      terminalRoic: wacc + Math.min(0.12, spread * 0.75),
    };
  }
  return {
    ...common,
    growth: baseGrowth,
    targetMargin: a.targetMargin,
    terminalGrowth: a.terminalGrowth,
    terminalRoic: wacc + Math.min(0.08, spread * 0.5),
  };
}

/** Avaliação completa. `overrides` substitui os pressupostos derivados dos dados. */
export function analyzeCompany(
  data: CompanyData,
  overrides: Partial<Assumptions> = {},
): CompanyAnalysis {
  const classification = classifyCompany(data);
  const profile = classification.type;
  const derived = deriveAssumptions(data, profile);
  const a: Assumptions = { ...derived.assumptions, ...overrides };
  const ctx = derived.context;
  const s = data.statements;
  const m = data.market;
  const price = m.price;
  const shares = m.shares;
  const cash = at(s.cash) ?? 0;
  const debt = at(s.totalDebt) ?? 0;
  const minority = at(s.minorityInterest) ?? 0;

  const wacc = computeWacc({
    riskFree: a.riskFree,
    beta: a.beta,
    matureErp: a.matureErp,
    crp: a.crp,
    preTaxCostOfDebt: a.preTaxCostOfDebt,
    taxRate: a.marginalTax,
    equityValue: m.marketCap,
    debtValue: profile === "financeira" ? 0 : debt,
  });
  const discount = profile === "financeira" ? wacc.costOfEquity : wacc.wacc;

  /* Lucro económico ------------------------------------------------- */
  const history = evaHistory(s, discount, a.marginalTax);
  const lastRoic = [...history].reverse().find((e) => isNum(e.roic))?.roic ?? null;
  const lastEva = [...history].reverse().find((e) => isNum(e.eva))?.eva ?? null;
  const marketEv = m.marketCap + debt - cash + minority;
  const ic = at(investedCapitalSeries(s));
  const capitalIntensity = isNum(ic) && marketEv > 0 ? ic / marketEv : null;
  const evaVal =
    profile === "financeira" || !isNum(ic) || !isNum(lastRoic)
      ? null
      : evaValuation({
          investedCapital: ic,
          roic: lastRoic,
          wacc: discount,
          growth: a.growth,
          terminalGrowth: a.terminalGrowth,
          persistence: 0.3,
          cash,
          debt,
          minorityInterest: minority,
          shares,
        });

  /* DCF -------------------------------------------------------------- */
  const dcfApplicable = profile !== "financeira" && isNum(ctx.baseRevenue) && ctx.baseRevenue > 0;
  const scenarioKeys: ScenarioKey[] = ["pessimista", "base", "otimista"];
  const scenarios = Object.fromEntries(
    scenarioKeys.map((k) => {
      const inputs = dcfInputsFor(data, a, ctx, discount, lastRoic, k);
      return [k, { inputs, result: dcfApplicable ? runDcf(inputs) : null }];
    }),
  ) as CompanyAnalysis["dcf"]["scenarios"];
  const scenarioValues = scenarioKeys.map((k) => [k, scenarios[k].result?.perShare] as const);
  const allScenarios = scenarioValues.every(([, v]) => isNum(v));
  const dcfValue = allScenarios
    ? scenarioValues.reduce((acc, [k, v]) => acc + SCENARIO_WEIGHTS[k] * (v as number), 0)
    : (scenarios.base.result?.perShare ?? null);
  const baseInputs = scenarios.base.inputs;

  /* Múltiplos -------------------------------------------------------- */
  const trailingEbitda =
    data.trailing.ebitda ??
    at(s.ebitda) ??
    (isNum(at(s.operatingIncome)) && isNum(at(s.depreciation))
      ? at(s.operatingIncome)! + Math.abs(at(s.depreciation)!)
      : null);
  const multInputs: MultipleInputs = {
    price,
    shares,
    eps:
      isNum(m.trailingPE) && m.trailingPE > 0
        ? price / m.trailingPE
        : safeDiv(at(s.netIncome), shares),
    forwardEps: isNum(m.forwardPE) && m.forwardPE > 0 ? price / m.forwardPE : null,
    // Nos REITs as imparidades de imóveis deprimem o EBITDA: usa-se o normalizado.
    ebitda: profile === "reit" ? (at(s.normalizedEbitda) ?? trailingEbitda) : trailingEbitda,
    ebit: ctx.baseEbit,
    revenue: ctx.baseRevenue,
    bookValue: at(s.equity),
    cash,
    debt,
    minorityInterest: minority,
  };
  const multiples = multiplesValuation(multInputs, data.peers, ctx.industry.industry, profile);

  /* Dividendos ------------------------------------------------------- */
  const dividend = isNum(m.dividendRate) && m.dividendRate > 0 ? m.dividendRate : null;
  const payout = ctx.payout;
  let ddmReason: string | null = null;
  if (!dividend) ddmReason = "Não paga dividendos.";
  else if (profile !== "reit" && profile !== "financeira" && isNum(payout) && payout < 0.25)
    ddmReason = "Distribui menos de 25 % dos lucros: os dividendos não mostram o valor da empresa.";
  const ddmInputs = {
    dividend: dividend ?? 0,
    costOfEquity: wacc.costOfEquity,
    growth: a.dividendGrowth,
    terminalGrowth: a.terminalGrowth,
  };
  const twoStage = dividend ? twoStageDdm(ddmInputs) : null;
  const ddmScen = dividend ? ddmScenarios(ddmInputs) : [];
  const ddmValue = (() => {
    const vals = ddmScen.map((x) => x.value);
    if (vals.length === 3 && vals.every(isNum))
      return 0.25 * vals[0]! + 0.5 * vals[1]! + 0.25 * vals[2]!;
    return twoStage?.value ?? null;
  })();
  const pv = pvgo(price, multInputs.eps, wacc.costOfEquity);

  /* Bancos ----------------------------------------------------------- */
  const bank =
    profile === "financeira" && isNum(at(s.equity))
      ? bankValuation({
          bookValue: at(s.equity)!,
          shares,
          roe: averageRoe(s) ?? 0,
          costOfEquity: wacc.costOfEquity,
          terminalGrowth: a.terminalGrowth,
          payout: isNum(payout) ? Math.min(payout, 1) : 0.4,
        })
      : null;

  /* REIT ------------------------------------------------------------- */
  const reitRef = reitReference(data.profile.industry);
  const reitAnalysis =
    profile === "reit"
      ? analyzeReit({
          statements: s,
          price,
          shares,
          marketCap: m.marketCap,
          dividendRate: dividend,
          capRate: a.capRate,
          pAffoTarget: a.pAffoTarget,
          maintenanceCapexPct: a.maintenanceCapexPct,
          forwardGrowth: data.analysts.revenueGrowthCurrentYear,
        })
      : null;

  /* Valor justo composto -------------------------------------------- */
  const weights = MODEL_WEIGHTS[profile];
  const evaReason =
    profile === "financeira"
      ? "Não se aplica a bancos."
      : !evaVal
        ? "Sem capital investido ou ROIC calculável."
        : isNum(capitalIntensity) && capitalIntensity < 0.25
          ? "Capital investido pequeno face ao valor de mercado (marcas e intangíveis ficam fora do balanço): o EVA subavalia."
          : null;
  const candidates: Array<[ModelKey, number | null, string | null]> = [
    [
      "dcf",
      dcfApplicable ? dcfValue : null,
      dcfApplicable ? null : "Não se aplica a bancos (a dívida é matéria-prima).",
    ],
    ["multiplos", multiples.value, multiples.value == null ? "Sem múltiplos aplicáveis." : null],
    ["ddm", ddmReason ? null : ddmValue, ddmReason],
    ["eva", evaReason ? null : (evaVal?.perShare ?? null), evaReason],
    ["pvc", bank?.justifiedPbValue ?? null, bank ? null : "Só para bancos e financeiras."],
    [
      "retorno_excesso",
      bank?.excessReturnValue ?? null,
      bank ? null : "Só para bancos e financeiras.",
    ],
    ["affo", reitAnalysis?.affoValue ?? null, reitAnalysis ? null : "Só para REITs."],
    ["nav", reitAnalysis?.navPerShare ?? null, reitAnalysis ? null : "Só para REITs."],
  ];
  const models: ModelValue[] = candidates.map(([key, value, reason]) => {
    const baseWeight = weights[key] ?? 0;
    const valid = isNum(value) && value > 0;
    return {
      key,
      label: MODEL_LABELS[key],
      value: valid ? value : null,
      baseWeight,
      weight: 0,
      included: baseWeight > 0 && valid,
      reason:
        baseWeight === 0
          ? (reason ?? "Não se usa neste tipo de empresa.")
          : valid
            ? null
            : (reason ?? "O modelo não deu um valor positivo."),
    };
  });
  // Modelos muito afastados dos restantes (mais de 3× ou menos de 1/3 da mediana).
  const incl = models.filter((x) => x.included);
  if (incl.length >= 3) {
    const med = median(incl.map((x) => x.value!))!;
    for (const x of incl) {
      if (x.value! > med * 3 || x.value! < med / 3) {
        x.included = false;
        x.reason =
          "Muito afastado dos outros modelos (mais de 3× ou menos de um terço da mediana).";
      }
    }
  }
  const totalWeight = models.filter((x) => x.included).reduce((acc, x) => acc + x.baseWeight, 0);
  for (const x of models) x.weight = x.included && totalWeight > 0 ? x.baseWeight / totalWeight : 0;
  const usedModels = models.filter((x) => x.included);
  const fairValue = usedModels.length
    ? usedModels.reduce((acc, x) => acc + x.weight * x.value!, 0)
    : null;
  const upside = isNum(fairValue) && price > 0 ? fairValue / price - 1 : null;
  const verdict: Verdict | null = !isNum(upside)
    ? null
    : upside >= 0.15
      ? "subavaliada"
      : upside <= -0.15
        ? "sobreavaliada"
        : "justa";
  const lowHigh = usedModels.map((x) => x.value!);
  const target = data.analysts.targetMean;
  const composite: Composite = {
    models,
    fairValue,
    low: lowHigh.length ? Math.min(...lowHigh) : null,
    high: lowHigh.length ? Math.max(...lowHigh) : null,
    upside,
    verdict,
    analystGap: isNum(fairValue) && isNum(target) && target > 0 ? fairValue / target - 1 : null,
    reliable: true,
  };

  /* Saúde e qualidade ------------------------------------------------ */
  const altmanApplicable = profile !== "financeira" && profile !== "reit";
  const alt = altmanApplicable
    ? altman(s, m.marketCap, isManufacturing(data.profile.sector, data.profile.industry))
    : null;
  const pio = piotroskiHistory(s);
  const ben = profile === "financeira" ? null : beneish(s);
  const quality = qualityMetrics(s);
  const health = {
    altman: alt,
    altmanApplicable,
    piotroski: pio,
    beneish: ben,
    quality,
    dupont: dupont(s),
    balance: profile === "financeira" ? null : financialBalance(s),
    score: healthScore(alt, pio[pio.length - 1] ?? null, quality, ben),
  };

  /* Gestão ----------------------------------------------------------- */
  const allocation = capitalAllocation(s, m.marketCap, quality.shareChange);
  const execution = executionRecord(data.earnings);
  const insiders = insiderSignal(data.insiders);
  const management = {
    allocation,
    execution,
    insiders,
    score: managementScore(
      history,
      discount,
      allocation,
      execution,
      insiders,
      reitAnalysis
        ? { ffoGrowth: reitAnalysis.ffoGrowth, affoPayout: reitAnalysis.affoPayout }
        : undefined,
    ),
  };

  /* Macro ------------------------------------------------------------ */
  const us10y = data.macro.us10y;
  const corporateBondYield = isNum(us10y) ? us10y + AAA_SPREAD : null;
  const longTermGrowth = marketAggregate().growth5y ?? 0.12;
  const macro = {
    fed: fedModel(data.macro.sp500PE, us10y),
    yardeni: yardeni(data.macro.sp500PE, corporateBondYield, longTermGrowth),
    corporateBondYield,
    longTermGrowth,
  };

  /* Alertas ---------------------------------------------------------- */
  const flags: Flag[] = [];
  const ebitNow = ctx.baseEbit;
  const fcfNow = data.trailing.freeCashFlow ?? at(s.freeCashFlow);
  if (isNum(ebitNow) && ebitNow < 0 && isNum(fcfNow) && fcfNow < 0) {
    const runway = cash / Math.abs(fcfNow);
    if (runway < 1) {
      flags.push({
        kind: "especulativa",
        severity: "aviso",
        text: `Ação especulativa: a empresa queima caixa e só tem dinheiro para cerca de ${Math.max(1, Math.round(runway * 12))} meses. O preço depende de novo financiamento (diluição) e o valor justo não é fiável: usa o intervalo, não o valor central.`,
      });
    } else {
      flags.push({
        kind: "prejuizo",
        severity: "aviso",
        text: "A empresa tem prejuízo operacional e consome caixa: os modelos dependem muito das margens futuras assumidas.",
      });
    }
  }
  const ps = priceStats(data);
  if (ps.worstWeek && ps.worstWeek.drop <= -0.35) {
    flags.push({
      kind: "quebra",
      severity: "aviso",
      text: `O preço caiu ${Math.round(-ps.worstWeek.drop * 100)} % numa semana (até ${ps.worstWeek.date}). Quedas destas costumam ser uma cisão (spin-off) ou fusão: as contas usadas podem ser as da empresa antes da mudança. Confirma nas notícias.`,
    });
  }
  // Armadilha de valor: grande queda recente e modelos (que olham para as contas
  // passadas) a dar um potencial enorme.
  if (isNum(ps.change12m) && ps.change12m <= -0.35 && isNum(upside) && upside >= 0.5) {
    flags.push({
      kind: "armadilha",
      severity: "aviso",
      text: `O preço caiu ${Math.round(-ps.change12m * 100)} % em 12 meses e os modelos dão um potencial de ${Math.round(upside * 100)} %. Cuidado com a armadilha de valor: o mercado pode estar a antecipar problemas (concorrência, perda de clientes, ocupação, refinanciamento) que as contas anuais ainda não mostram. Confirma as notícias e o último relatório trimestral.`,
    });
  }
  if (
    isNum(fairValue) &&
    price > 0 &&
    (fairValue / price > 3 || fairValue / price < 1 / 3) &&
    !(isNum(target) && (data.analysts.count ?? 0) >= 3)
  ) {
    flags.push({
      kind: "afastado",
      severity: "aviso",
      text: "Valor justo muito afastado do preço e sem alvo de analistas para comparar. Confirma nas demonstrações a moeda das contas e o número de ações: diferenças deste tamanho vêm muitas vezes dos dados.",
    });
  }
  // "Holding" no nome não chega (ASML Holding, Booking Holdings são operacionais).
  const industryText = (data.profile.industry ?? "").toLowerCase();
  const isHolding =
    /conglomerat/.test(industryText) ||
    (/\bholdings?\b/i.test(data.profile.name) &&
      /asset management|capital markets|diversified/.test(industryText));
  if (isHolding) {
    flags.push({
      kind: "holding",
      severity: "info",
      text: "Holding: vale sobretudo pelas participações noutras empresas. O mercado costuma aplicar um desconto de 20 % a 50 % face ao valor dessas participações.",
    });
  }
  if (data.profile.financialCurrency !== m.currency) {
    flags.push({
      kind: "moeda",
      severity: "info",
      text: `As contas são em ${data.profile.financialCurrency} e a cotação em ${m.currency}: os valores foram convertidos ao câmbio atual.`,
    });
  }
  if (s.periods.length < 3) {
    flags.push({
      kind: "historico",
      severity: "info",
      text: "Menos de 3 anos de contas: as médias e tendências são menos fiáveis.",
    });
  }
  // Modelos que discordam muito entre si: o valor central vale pouco.
  const usedValues = usedModels.map((x) => x.value!);
  if (usedValues.length >= 2 && Math.max(...usedValues) / Math.min(...usedValues) > 3) {
    flags.push({
      kind: "discordantes",
      severity: "aviso",
      text: `Os modelos discordam muito (de ${formatMoney(Math.min(...usedValues), m.currency)} a ${formatMoney(Math.max(...usedValues), m.currency)} por ação): o valor central é pouco fiável. Vê no Resumo de onde vem a diferença.`,
    });
  }
  const gap = composite.analystGap;
  if (isNum(gap) && Math.abs(gap) > 0.3 && (data.analysts.count ?? 0) >= 3) {
    const n = data.analysts.count;
    const tgt = formatMoney(target!, m.currency);
    flags.push(
      gap > 0
        ? {
            kind: "analistas",
            // Modelos muito acima do consenso e do preço: possível armadilha de valor.
            severity: isNum(upside) && upside >= 0.5 ? "aviso" : "info",
            text: `Os modelos ficam ${Math.round(gap * 100)} % acima do alvo médio de ${n} analistas (${tgt}). Quando os modelos dão muito mais do que o mercado e os analistas, é comum haver problemas que as contas do último ano ainda não mostram (armadilha de valor): confirma as notícias e o último relatório trimestral.`,
          }
        : {
            kind: "analistas",
            severity: "info",
            text: `Os modelos ficam ${Math.round(-gap * 100)} % abaixo do alvo médio de ${n} analistas (${tgt}). Os analistas costumam ver crescimento que os modelos clássicos não apanham; a verdade costuma estar entre os dois.`,
          },
    );
  }

  /* Nota global ------------------------------------------------------ */
  composite.reliable = !flags.some(
    (f) => UNRELIABLE_FLAGS.has(f.kind) || (f.kind === "analistas" && f.severity === "aviso"),
  );
  // Um potencial pouco fiável conta como neutro (perto do valor justo).
  const scoreUpside = isNum(upside) ? (composite.reliable ? upside : Math.min(upside, 0)) : null;
  const valuationPart = isNum(scoreUpside) ? clamp((scoreUpside + 0.3) / 0.6, 0, 1) * 100 : null;
  const spreadNow = isNum(lastRoic) ? lastRoic - discount : null;
  const profitabilityBits: number[] = [];
  if (isNum(spreadNow)) {
    profitabilityBits.push(
      spreadNow >= 0.1
        ? 100
        : spreadNow >= 0.05
          ? 80
          : spreadNow >= 0
            ? 60
            : spreadNow >= -0.03
              ? 35
              : 10,
    );
  }
  if (isNum(quality.fcfMargin)) {
    const f = quality.fcfMargin;
    profitabilityBits.push(f >= 0.15 ? 100 : f >= 0.08 ? 75 : f >= 0.03 ? 50 : f >= 0 ? 30 : 0);
  }
  if (isNum(quality.cashConversion)) {
    const c = quality.cashConversion;
    profitabilityBits.push(c >= 1 ? 100 : c >= 0.8 ? 75 : c >= 0.5 ? 40 : 10);
  }
  const profitability = profitabilityBits.length
    ? profitabilityBits.reduce((x, y) => x + y, 0) / profitabilityBits.length
    : null;
  const healthPart = profile === "reit" && reitAnalysis ? null : health.score.score;
  const reitPart = reitAnalysis ? reitScore(reitAnalysis, scoreUpside) : null;
  const parts: ScoreBreakdown["parts"] = [
    { label: "Valorização", value: valuationPart, weight: 0.35 },
    {
      label: profile === "reit" ? "Nota REIT" : "Saúde financeira",
      value:
        profile === "reit" ? (isNum(reitPart?.score) ? reitPart!.score! * 10 : null) : healthPart,
      weight: 0.25,
    },
    { label: "Rentabilidade", value: profitability, weight: 0.2 },
    { label: "Gestão", value: management.score.score, weight: 0.2 },
  ];
  const known = parts.filter((p) => isNum(p.value));
  const kw = known.reduce((x, p) => x + p.weight, 0);
  const total = kw >= 0.5 ? known.reduce((x, p) => x + p.weight * p.value!, 0) / kw : null;

  return {
    classification,
    assumptions: a,
    defaults: derived.assumptions,
    context: ctx,
    notes: derived.notes,
    wacc,
    dcf: {
      applicable: dcfApplicable,
      reason: dcfApplicable
        ? null
        : "Nos bancos a dívida é matéria-prima: o DCF por fluxos da empresa não se aplica.",
      scenarios,
      value: dcfApplicable ? dcfValue : null,
      impliedGrowth: dcfApplicable ? impliedGrowth(baseInputs, price) : null,
      sensitivity: dcfApplicable && scenarios.base.result ? sensitivity(baseInputs) : null,
      monteCarlo: dcfApplicable && scenarios.base.result ? monteCarlo(baseInputs, price) : null,
    },
    multiples: { inputs: multInputs, result: multiples },
    ddm: {
      applicable: !ddmReason,
      reason: ddmReason,
      dividend,
      gordonValue: dividend
        ? gordon(dividend * (1 + a.terminalGrowth), wacc.costOfEquity, a.terminalGrowth)
        : null,
      twoStage,
      scenarios: ddmScen,
      value: ddmValue,
      pvgo: pv,
    },
    eva: {
      history,
      valuation: evaVal,
      creation: valueCreation(s, marketEv, lastEva, discount),
      capitalIntensity,
    },
    bank,
    reit: reitAnalysis ? { reference: reitRef, analysis: reitAnalysis, score: reitPart! } : null,
    health,
    management,
    macro,
    composite,
    flags,
    priceStats: ps,
    score: { total, parts },
  };
}
