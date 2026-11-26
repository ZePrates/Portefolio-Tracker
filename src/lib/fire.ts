/**
 * Progresso FIRE (independência financeira) — lógica pura.
 * Tudo em euros de hoje: o retorno usado na projeção é o retorno REAL
 * (nominal descontado da inflação), por isso o "número FIRE" não precisa de
 * ser inflacionado.
 */

export interface FireSettings {
  /** Despesas anuais atuais (EUR). */
  annualExpenses: number;
  /** Taxa de levantamento segura, em % (ex.: 4 → regra dos 25×). */
  safeWithdrawalRate: number;
  /** Aporte mensal (EUR de hoje). */
  monthlyContribution: number;
  /** Retorno nominal anual esperado, em %. */
  expectedReturnPct: number;
  /** Inflação anual esperada, em %. */
  inflationPct: number;
}

export interface FireProgress {
  /** Capital necessário: despesas ÷ taxa de levantamento. */
  fireNumber: number;
  progressPct: number;
  remaining: number;
  /** Rendimento passivo (dividendos 12 m) ÷ despesas, em %. */
  passiveCoveragePct: number;
  /** Retorno real anual usado na projeção, em %. */
  realReturnPct: number;
  /** Anos até atingir o número FIRE (null se não for atingível em 100 anos). */
  yearsToFire: number | null;
  /** Mês estimado (YYYY-MM). */
  fireMonth: string | null;
}

const MAX_MONTHS = 100 * 12;

/** Taxa liberatória sobre mais-valias em Portugal (art. 72.º CIRS). */
export const PT_CAPITAL_GAINS_TAX = 0.28;

function realMonthlyRate(s: FireSettings): number {
  const realAnnual = (1 + s.expectedReturnPct / 100) / (1 + s.inflationPct / 100) - 1;
  return Math.pow(1 + realAnnual, 1 / 12) - 1;
}

/** Meses até `value` chegar a `target` (0 se já lá está; null se não chega em 100 anos). */
function monthsToTarget(
  value: number,
  target: number,
  monthlyRate: number,
  contribution: number,
): number | null {
  if (value >= target) return 0;
  let v = value;
  for (let m = 1; m <= MAX_MONTHS; m++) {
    v = v * (1 + monthlyRate) + Math.max(0, contribution);
    if (v >= target) return m;
  }
  return null;
}

function addMonths(today: string, months: number | null): string | null {
  if (months == null) return null;
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 7);
}

function toYears(months: number | null): number | null {
  return months == null ? null : Math.round((months / 12) * 10) / 10;
}

export function fireProgress(
  settings: FireSettings,
  portfolioValue: number,
  annualPassiveIncome: number,
  today: string,
): FireProgress {
  const swr = settings.safeWithdrawalRate / 100;
  const fireNumber = swr > 0 ? settings.annualExpenses / swr : Number.POSITIVE_INFINITY;
  const value = Math.max(0, portfolioValue);
  const realAnnual = (1 + settings.expectedReturnPct / 100) / (1 + settings.inflationPct / 100) - 1;
  const monthlyRate = realMonthlyRate(settings);

  const months = monthsToTarget(value, fireNumber, monthlyRate, settings.monthlyContribution);
  const fireMonth = addMonths(today, months);

  return {
    fireNumber,
    progressPct: Number.isFinite(fireNumber) && fireNumber > 0 ? (value / fireNumber) * 100 : 0,
    remaining: Number.isFinite(fireNumber)
      ? Math.max(0, fireNumber - value)
      : Number.POSITIVE_INFINITY,
    passiveCoveragePct:
      settings.annualExpenses > 0
        ? (Math.max(0, annualPassiveIncome) / settings.annualExpenses) * 100
        : 0,
    realReturnPct: realAnnual * 100,
    yearsToFire: toYears(months),
    fireMonth,
  };
}

/* ------------------------------------------------------------------ */
/* Patamares, Coast FIRE e impostos                                    */
/* ------------------------------------------------------------------ */

export interface FireLevelDef {
  key: "half" | "lean" | "fire" | "fat";
  name: string;
  /** Múltiplo do número FIRE. */
  multiple: number;
  info: string;
}

export const FIRE_LEVELS: readonly FireLevelDef[] = [
  {
    key: "half",
    name: "Half / Barista",
    multiple: 0.5,
    info: "A carteira já paga metade das tuas despesas anuais; o resto vem de um trabalho a tempo parcial ou mais leve (o nome vem de quem trabalha num café só para ter algum rendimento). Dá para trabalhar menos sem esperar pelo FIRE completo.",
  },
  {
    key: "lean",
    name: "Lean",
    multiple: 0.7,
    info: "Independência com orçamento apertado: a carteira cobre cerca de 70 % das despesas atuais. Só chega se viveres de forma frugal, cortando cerca de 30 % aos gastos, e deixa pouca margem para imprevistos.",
  },
  {
    key: "fire",
    name: "FIRE",
    multiple: 1,
    info: "Financial Independence, Retire Early: a carteira paga todas as despesas atuais só com o levantamento anual à taxa escolhida (ex.: 4 %). Número FIRE = despesas anuais ÷ taxa de levantamento; com 4 % são 25 vezes as despesas.",
  },
  {
    key: "fat",
    name: "Fat",
    multiple: 1.5,
    info: "Independência com folga: a carteira cobre 50 % mais do que gastas hoje. Dá margem para viagens, imprevistos ou anos maus nos mercados sem cortar no estilo de vida.",
  },
];

/** Explicações dos conceitos FIRE que não são patamares. */
export const FIRE_INFO = {
  coast:
    "Coast FIRE: a carteira atual, sem mais nenhum aporte, continua a crescer sozinha até chegar ao número FIRE. Entretanto só precisas de ganhar o suficiente para pagar as despesas do dia a dia. Aqui vês quando lá chegarias se parasses hoje de investir.",
  flamingo:
    "Flamingo FIRE: investes até teres metade do número FIRE e, a partir daí, deixas de investir e passas a trabalhar menos, só o suficiente para pagar as despesas. A carteira continua a crescer sozinha até ao FIRE completo (com ~7 % ao ano duplica em cerca de 10 anos). Junta o Barista e o Coast FIRE.",
  tax: "Em Portugal as mais-valias pagam 28 % quando vendes. Cada levantamento inclui uma parte de lucro, por isso precisas de uma carteira maior para que o valor líquido cubra as despesas. Este é o número FIRE já com esse imposto.",
} as const;

export interface FireLevel extends FireLevelDef {
  target: number;
  reached: boolean;
  /** Progresso até este patamar, em % (0–100). */
  progressPct: number;
  remaining: number;
  /** Anos até lá, com os aportes atuais. */
  years: number | null;
  /** Meses até lá (exato, para mostrar "x anos e y meses"). */
  monthsAway: number | null;
  month: string | null;
}

export interface FireCoast {
  /** Anos até ao FIRE se deixares de investir hoje (null se não chega em 100 anos). */
  years: number | null;
  monthsAway: number | null;
  month: string | null;
}

/** Fração do número FIRE a partir da qual o Flamingo FIRE para os aportes. */
export const FLAMINGO_SHARE = 0.5;

export interface FireFlamingo {
  /** Alvo intermédio: metade do número FIRE. */
  target: number;
  /** Já tens metade do número FIRE (a fase de investir terminou). */
  halfReached: boolean;
  /** Progresso até metade do número FIRE, em % (0–100). */
  progressPct: number;
  /** Anos/mês até chegar a metade do número FIRE com os aportes atuais. */
  halfYears: number | null;
  /** Meses até metade do número FIRE. */
  monthsToHalf: number | null;
  halfMonth: string | null;
  /** Anos desde a metade até ao FIRE completo, sem mais aportes. */
  coastYears: number | null;
  /** Anos/mês (a contar de hoje) até ao FIRE completo. */
  fireYears: number | null;
  /** Meses (a contar de hoje) até ao FIRE completo. */
  monthsToFire: number | null;
  fireMonth: string | null;
}

export interface FireTax {
  /** Taxa aplicada às mais-valias (ex.: 0,28). */
  rate: number;
  /** Peso das mais-valias latentes no valor atual da carteira, em %. */
  gainSharePct: number;
  /** Imposto efetivo hoje sobre cada euro levantado, em %. */
  effectiveRatePct: number;
  /** Valor bruto da carteira necessário no FIRE para levantar as despesas já líquidas. */
  fireNumber: number;
  yearsToFire: number | null;
  fireMonth: string | null;
}

export interface FireScenario {
  key: "prudent" | "historical" | "optimistic" | "yours";
  name: string;
  /** Retorno real anual, em %. */
  realReturnPct: number;
  /** Retorno nominal equivalente com a inflação escolhida, em %. */
  nominalReturnPct: number;
  years: number | null;
  month: string | null;
}

/**
 * Cenários de retorno real para comparar com o escolhido. As ações globais
 * renderam cerca de 5 % real ao ano a longo prazo; 3 % e 7 % dão a margem.
 */
export const FIRE_SCENARIOS: readonly { key: FireScenario["key"]; name: string; real: number }[] = [
  { key: "prudent", name: "Prudente", real: 3 },
  { key: "historical", name: "Histórico", real: 5 },
  { key: "optimistic", name: "Otimista", real: 7 },
];

/** Retorno real acima do qual a previsão é tratada como otimista, em %. */
export const FIRE_OPTIMISTIC_REAL_PCT = 7;

export interface FireDetails {
  /** Valor atual da carteira usado nas contas (EUR). */
  portfolioValue: number;
  levels: FireLevel[];
  coast: FireCoast;
  flamingo: FireFlamingo;
  tax: FireTax | null;
  /** Data do FIRE com outros retornos (mesmas despesas e aportes). */
  scenarios: FireScenario[];
  /** O retorno real escolhido está acima do cenário otimista. */
  optimistic: boolean;
}

/**
 * Patamares FIRE, Coast FIRE e FIRE com impostos.
 *
 * Impostos: cada euro levantado leva consigo uma parte de mais-valia
 * (1 − custo ÷ valor), tributada à taxa `taxRate`. Na projeção o custo de
 * aquisição é nominal, por isso perde valor real com a inflação, e cresce com
 * os aportes. O FIRE com impostos é atingido quando o levantamento líquido
 * (valor × taxa de levantamento × (1 − imposto efetivo)) cobre as despesas.
 */
export function fireDetails(
  settings: FireSettings,
  portfolioValue: number,
  costBasis: number,
  today: string,
  taxRate: number = PT_CAPITAL_GAINS_TAX,
): FireDetails {
  const swr = settings.safeWithdrawalRate / 100;
  const fireNumber = swr > 0 ? settings.annualExpenses / swr : Number.POSITIVE_INFINITY;
  const value = Math.max(0, portfolioValue);
  const rate = realMonthlyRate(settings);
  const contribution = Math.max(0, settings.monthlyContribution);

  const levels: FireLevel[] = FIRE_LEVELS.map((def) => {
    const target = fireNumber * def.multiple;
    const months = monthsToTarget(value, target, rate, contribution);
    return {
      ...def,
      target,
      reached: value >= target,
      progressPct:
        Number.isFinite(target) && target > 0 ? Math.min(100, (value / target) * 100) : 0,
      remaining: Number.isFinite(target) ? Math.max(0, target - value) : Number.POSITIVE_INFINITY,
      years: toYears(months),
      monthsAway: months,
      month: addMonths(today, months),
    };
  });

  const coastMonths = monthsToTarget(value, fireNumber, rate, 0);
  const coast: FireCoast = {
    years: toYears(coastMonths),
    monthsAway: coastMonths,
    month: addMonths(today, coastMonths),
  };

  const yoursReal =
    ((1 + settings.expectedReturnPct / 100) / (1 + settings.inflationPct / 100) - 1) * 100;
  const scenario = (key: FireScenario["key"], name: string, real: number): FireScenario => {
    const r = Math.pow(1 + real / 100, 1 / 12) - 1;
    const months = monthsToTarget(value, fireNumber, r, contribution);
    return {
      key,
      name,
      realReturnPct: real,
      nominalReturnPct: ((1 + real / 100) * (1 + settings.inflationPct / 100) - 1) * 100,
      years: toYears(months),
      month: addMonths(today, months),
    };
  };
  const scenarios = [
    ...FIRE_SCENARIOS.map((s) => scenario(s.key, s.name, s.real)),
    scenario("yours", "O teu", yoursReal),
  ];

  return {
    portfolioValue: value,
    levels,
    coast,
    flamingo: fireFlamingo(value, fireNumber, rate, contribution, today),
    tax: fireTax(settings, value, costBasis, today, taxRate),
    scenarios,
    optimistic: yoursReal > FIRE_OPTIMISTIC_REAL_PCT + 1e-9,
  };
}

/**
 * Flamingo FIRE: investir com os aportes atuais até metade do número FIRE e,
 * daí em diante, parar os aportes e deixar a carteira crescer até ao FIRE
 * completo (trabalhando só o suficiente para as despesas).
 */
function fireFlamingo(
  value: number,
  fireNumber: number,
  rate: number,
  contribution: number,
  today: string,
): FireFlamingo {
  const target = fireNumber * FLAMINGO_SHARE;
  const halfMonths = monthsToTarget(value, target, rate, contribution);
  let atHalf = value;
  for (let m = 0; m < (halfMonths ?? 0); m++) atHalf = atHalf * (1 + rate) + contribution;
  const coastMonths = halfMonths == null ? null : monthsToTarget(atHalf, fireNumber, rate, 0);
  const totalMonths =
    halfMonths == null || coastMonths == null || halfMonths + coastMonths > MAX_MONTHS
      ? null
      : halfMonths + coastMonths;
  return {
    target,
    halfReached: value >= target,
    progressPct: Number.isFinite(target) && target > 0 ? Math.min(100, (value / target) * 100) : 0,
    halfYears: toYears(halfMonths),
    monthsToHalf: halfMonths,
    halfMonth: addMonths(today, halfMonths),
    coastYears: toYears(coastMonths),
    fireYears: toYears(totalMonths),
    monthsToFire: totalMonths,
    fireMonth: addMonths(today, totalMonths),
  };
}

function fireTax(
  settings: FireSettings,
  value: number,
  costBasis: number,
  today: string,
  taxRate: number,
): FireTax | null {
  const swr = settings.safeWithdrawalRate / 100;
  if (!(swr > 0) || !(taxRate > 0 && taxRate < 1) || settings.annualExpenses <= 0) return null;
  const rate = realMonthlyRate(settings);
  const deflate = Math.pow(1 + settings.inflationPct / 100, 1 / 12);
  const contribution = Math.max(0, settings.monthlyContribution);
  const gainShare = (v: number, c: number) => (v > 0 ? Math.max(0, 1 - Math.max(0, c) / v) : 0);
  const netIncome = (v: number, c: number) => v * swr * (1 - taxRate * gainShare(v, c));

  let v = value;
  let c = Math.max(0, costBasis);
  let months: number | null = null;
  for (let m = 0; m <= MAX_MONTHS; m++) {
    if (m > 0) {
      v = v * (1 + rate) + contribution;
      c = c / deflate + contribution;
    }
    if (netIncome(v, c) >= settings.annualExpenses) {
      months = m;
      break;
    }
  }

  // Valor bruto necessário: no mês em que é atingido; se nunca, com o peso de mais-valias de hoje.
  const share = months != null ? gainShare(v, c) : gainShare(value, costBasis);
  const share0 = gainShare(value, costBasis);
  return {
    rate: taxRate,
    gainSharePct: share0 * 100,
    effectiveRatePct: taxRate * share0 * 100,
    fireNumber: settings.annualExpenses / (swr * (1 - taxRate * share)),
    yearsToFire: toYears(months),
    fireMonth: addMonths(today, months),
  };
}
