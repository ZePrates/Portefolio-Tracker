/**
 * Perfil de risco: coeficiente de aversão ao risco A (questionário) e a
 * utilidade média-variância de Markowitz aplicada à carteira.
 *
 * Camada PURA: sem rede nem base de dados. A UI (risk-profile-panel) só
 * formata e mostra o que sai daqui.
 *
 *   U  = E(r) − ½·A·σ²                 (utilidade = "equivalente certo")
 *   y* = (E(r) − rf) / (A·σ²)          (fração ótima em ativos de risco)
 *
 * E(r) e σ vêm das rentabilidades mensais (TWR) da parte de risco da carteira
 * (ETFs, ações e REITs), calculadas sobre as fotografias diárias com as mesmas
 * funções do Desempenho (`twr`, `twrFlows`). Todas as taxas aqui são frações
 * (0,1 = 10 %); a conversão para % fica na apresentação.
 */

import { todayISO } from "@/lib/dashboard";
import type { DividendRecord } from "@/lib/dividends";
import { formatPct, formatPp, parseNumberPt } from "@/lib/format";
import {
  twr,
  twrFlows,
  type PerfTransaction,
  type PeriodReturn,
  type ValuationPoint,
} from "@/lib/performance";
import {
  CLASS_LABELS,
  CLASS_ORDER,
  assetCurrentValue,
  isOpenPosition,
  type Asset,
  type AssetClass,
} from "@/lib/portfolio-types";

/* ------------------------------------------------------------------ */
/* Questionário                                                        */
/* ------------------------------------------------------------------ */

const pct = (n: number) => `${n > 0 ? "+" : ""}${formatPct(n, 0)}`;

/**
 * Perguntas do questionário. Em cada uma, as opções vão da mais prudente
 * (0 pontos) à mais tolerante ao risco (3 pontos): a pontuação de uma
 * resposta é o índice da opção escolhida.
 */
export const RISK_QUESTIONS = [
  {
    id: "horizon",
    topic: "Horizonte",
    question: "Daqui a quanto tempo contas usar a maior parte deste dinheiro?",
    options: ["Menos de 3 anos", "3 a 7 anos", "7 a 15 anos", "Mais de 15 anos"],
  },
  {
    id: "drawdown",
    topic: `Queda de ${formatPct(20, 0)}`,
    question: `Se a carteira caísse ${formatPct(20, 0)} em poucos meses, o que farias?`,
    options: [
      "Vendia tudo para não perder mais",
      "Vendia uma parte",
      "Não mexia em nada",
      "Aproveitava para comprar mais",
    ],
  },
  {
    id: "income",
    topic: "Rendimento",
    question: "Quão estável é o teu rendimento do trabalho (ou pensão)?",
    options: [
      "Instável ou sem rendimento fixo",
      "Variável (comissões, recibos verdes)",
      "Estável (contrato sem termo)",
      "Muito estável ou com várias fontes",
    ],
  },
  {
    id: "emergency",
    topic: "Fundo de emergência",
    question: "Tens um fundo de emergência fora dos investimentos?",
    options: [
      "Não",
      "Sim, menos de 3 meses de despesas",
      "Sim, 3 a 6 meses de despesas",
      "Sim, mais de 6 meses de despesas",
    ],
  },
  {
    id: "experience",
    topic: "Experiência",
    question: "Há quanto tempo investes em ações ou ETFs?",
    options: [
      "Menos de 1 ano",
      "1 a 3 anos",
      "3 a 10 anos",
      "Mais de 10 anos, já passei por várias crises",
    ],
  },
  {
    id: "goal",
    topic: "Objetivo",
    question: "Qual é o principal objetivo desta carteira?",
    options: [
      "Preservar o capital",
      "Gerar rendimento regular",
      "Crescimento equilibrado",
      "Máximo crescimento a longo prazo",
    ],
  },
  {
    id: "maxLoss",
    topic: "Perda tolerada",
    question: "Qual é a maior perda num ano que aceitarias sem mudar de plano?",
    options: [
      `Até ${formatPct(5, 0)}`,
      `Até ${formatPct(10, 0)}`,
      `Até ${formatPct(20, 0)}`,
      `${formatPct(30, 0)} ou mais`,
    ],
  },
  {
    id: "range",
    topic: "Risco e retorno",
    question: "Num ano, que intervalo de resultados preferes para a carteira?",
    options: [
      `Entre ${pct(3)} e ${pct(5)}, quase garantido`,
      `Entre ${pct(-5)} e ${pct(12)}`,
      `Entre ${pct(-15)} e ${pct(25)}`,
      `Entre ${pct(-30)} e ${pct(50)}`,
    ],
  },
  {
    id: "share",
    topic: "Peso no património",
    question: "Que parte do teu património (sem contar a casa) está nesta carteira?",
    options: [
      `Mais de ${formatPct(75, 0)}`,
      `${formatPct(50, 0)} a ${formatPct(75, 0)}`,
      `${formatPct(25, 0)} a ${formatPct(50, 0)}`,
      `Menos de ${formatPct(25, 0)}`,
    ],
  },
  {
    id: "debt",
    topic: "Encargos",
    question: "Que parte do rendimento mensal vai para prestações de créditos?",
    options: [
      `Mais de ${formatPct(40, 0)}`,
      `${formatPct(25, 0)} a ${formatPct(40, 0)}`,
      `${formatPct(10, 0)} a ${formatPct(25, 0)}`,
      `Menos de ${formatPct(10, 0)} ou nenhuma`,
    ],
  },
] as const;

export type RiskQuestionId = (typeof RISK_QUESTIONS)[number]["id"];
export type RiskAnswers = Partial<Record<RiskQuestionId, number>>;

export const RISK_QUESTION_IDS: RiskQuestionId[] = RISK_QUESTIONS.map((q) => q.id);
const POINTS_PER_QUESTION = 3;
export const MAX_SCORE = RISK_QUESTIONS.length * POINTS_PER_QUESTION;

/** Respostas válidas a partir de dados não confiáveis (JSON da base de dados ou do pedido). */
export function sanitizeAnswers(raw: unknown): RiskAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: RiskAnswers = {};
  for (const q of RISK_QUESTIONS) {
    const v = (raw as Record<string, unknown>)[q.id];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < q.options.length) {
      out[q.id] = v;
    }
  }
  return out;
}

export interface RiskScore {
  score: number;
  answered: number;
  total: number;
  complete: boolean;
}

export function scoreAnswers(answers: RiskAnswers): RiskScore {
  const clean = sanitizeAnswers(answers);
  const values = Object.values(clean);
  return {
    score: values.reduce((s, v) => s + v, 0),
    answered: values.length,
    total: RISK_QUESTIONS.length,
    complete: values.length === RISK_QUESTIONS.length,
  };
}

/* ------------------------------------------------------------------ */
/* Conversão pontuação → A                                             */
/* ------------------------------------------------------------------ */

export type RiskProfileKey =
  "muito_conservador" | "conservador" | "moderado" | "dinamico" | "agressivo";

export const RISK_PROFILES: Record<RiskProfileKey, { label: string; description: string }> = {
  muito_conservador: {
    label: "Muito conservador",
    description: "A prioridade é não perder; oscilações grandes pesam muito.",
  },
  conservador: {
    label: "Conservador",
    description: "Aceitas algumas oscilações, mas a estabilidade conta mais do que o retorno.",
  },
  moderado: {
    label: "Moderado",
    description: "Equilibras retorno e estabilidade; aceitas quedas intermédias.",
  },
  dinamico: {
    label: "Dinâmico",
    description: "Aceitas quedas fortes em troca de mais retorno esperado a prazo.",
  },
  agressivo: {
    label: "Agressivo",
    description: "Toleras grandes quedas; o retorno a longo prazo é o que importa.",
  },
};

export function profileForAversion(a: number): RiskProfileKey {
  if (a >= 9) return "muito_conservador";
  if (a >= 7) return "conservador";
  if (a >= 5) return "moderado";
  if (a >= 3) return "dinamico";
  return "agressivo";
}

export interface AversionBand {
  /** Coeficiente de aversão ao risco (1 = tolera muito risco, 10 = quase nenhum). */
  a: number;
  minScore: number;
  maxScore: number;
  profile: RiskProfileKey;
}

const BAND_WIDTH = 3;

/**
 * Tabela de conversão: 10 escalões de 3 pontos. Mais pontos = mais tolerância
 * ao risco = A mais baixo. O último escalão (A = 1) inclui a pontuação máxima.
 */
export const AVERSION_TABLE: AversionBand[] = Array.from({ length: 10 }, (_, i) => {
  const a = 10 - i;
  return {
    a,
    minScore: i * BAND_WIDTH,
    maxScore: i === 9 ? MAX_SCORE : i * BAND_WIDTH + BAND_WIDTH - 1,
    profile: profileForAversion(a),
  };
});

export function aversionFromScore(score: number): number {
  const s = Math.min(MAX_SCORE, Math.max(0, Math.round(score)));
  return AVERSION_TABLE.find((b) => s >= b.minScore && s <= b.maxScore)?.a ?? 10;
}

/* ------------------------------------------------------------------ */
/* Rentabilidades mensais da parte de risco                            */
/* ------------------------------------------------------------------ */

/** Classes tratadas como "de risco" no modelo (ações, ETFs, REITs). */
export const RISKY_CLASSES: readonly AssetClass[] = [
  "etf",
  "acao_crescimento",
  "reit",
  "acao_dividendo",
];
/** Classes mais defensivas (a liquidez fora da carteira soma-se a estas). */
export const DEFENSIVE_CLASSES: readonly AssetClass[] = ["metal", "p2p"];

const RISKY = new Set<AssetClass>(RISKY_CLASSES);

export interface SnapshotLike {
  snapshotDate: string;
  scope: string;
  marketValue: number | null;
}

function monthIndex(iso: string): number {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
}

/**
 * Valor da parte de risco na última fotografia de cada mês já terminado.
 * Soma as fotografias por classe (`class:etf`, ...) e ignora, por classe, as
 * anteriores à primeira transação (o ledger não as explica — mesma regra de
 * `returnsByClass`); classes sem transações ficam de fora pelo mesmo motivo.
 * O mês corrente fica de fora: um mês a meio não é uma rentabilidade mensal.
 */
export function riskyMonthEndValuations(
  assets: Pick<Asset, "id" | "class">[],
  transactions: PerfTransaction[],
  snapshots: SnapshotLike[],
  today = todayISO(),
): ValuationPoint[] {
  const classOf = new Map(assets.map((a) => [a.id, a.class]));
  const firstFlow = new Map<AssetClass, string>();
  for (const t of transactions) {
    const c = t.asset_id ? classOf.get(t.asset_id) : undefined;
    if (!c || !RISKY.has(c)) continue;
    const d = t.traded_at.slice(0, 10);
    const cur = firstFlow.get(c);
    if (!cur || d < cur) firstFlow.set(c, d);
  }

  const byDate = new Map<string, number>();
  for (const s of snapshots) {
    if (!s.scope.startsWith("class:")) continue;
    const c = s.scope.slice("class:".length) as AssetClass;
    const first = firstFlow.get(c);
    if (!RISKY.has(c) || !first || s.snapshotDate < first) continue;
    if (s.marketValue == null || !Number.isFinite(s.marketValue)) continue;
    byDate.set(s.snapshotDate, (byDate.get(s.snapshotDate) ?? 0) + Number(s.marketValue));
  }

  const currentMonth = today.slice(0, 7);
  const lastOfMonth = new Map<string, ValuationPoint>();
  for (const [date, value] of byDate) {
    const month = date.slice(0, 7);
    if (month >= currentMonth) continue;
    const cur = lastOfMonth.get(month);
    if (!cur || date > cur.date) lastOfMonth.set(month, { date, value });
  }
  return [...lastOfMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Rentabilidades mensais (TWR) da parte de risco: as valorizações de fim de
 * mês encadeadas com os fluxos do ledger (compras, vendas e dividendos dessas
 * classes). Meses sem fotografia não se juntam ao seguinte: um sub-período de
 * dois meses contaria como um mês e inflacionava a volatilidade.
 */
export function riskyMonthlyReturns(
  assets: Pick<Asset, "id" | "class">[],
  transactions: PerfTransaction[],
  dividends: DividendRecord[],
  snapshots: SnapshotLike[],
  today = todayISO(),
): PeriodReturn[] {
  const classOf = new Map(assets.map((a) => [a.id, a.class]));
  const isRisky = (id: string | null | undefined) => {
    const c = id ? classOf.get(id) : undefined;
    return !!c && RISKY.has(c);
  };
  const tx = transactions.filter((t) => isRisky(t.asset_id));
  const divs = dividends.filter((d) => isRisky(d.asset_id));
  const points = riskyMonthEndValuations(assets, tx, snapshots, today);
  return twr(points, twrFlows(tx, divs, today)).periods.filter(
    (p) => monthIndex(p.to) - monthIndex(p.from) === 1,
  );
}

/* ------------------------------------------------------------------ */
/* Estatísticas anualizadas                                            */
/* ------------------------------------------------------------------ */

/** Mínimo de meses para estimar E(r) e σ (com menos, os números dizem pouco). */
export const MIN_MONTHS = 12;
/** Abaixo disto, a estimativa é mostrada com um aviso de amostra curta. */
export const SHORT_SAMPLE_MONTHS = 36;

export interface AnnualizedStats {
  months: number;
  /** Início do primeiro mês e fim do último (datas das fotografias). */
  from: string | null;
  to: string | null;
  meanMonthly: number | null;
  volMonthly: number | null;
  /** Retorno esperado anual: 12 × média mensal. */
  expectedReturn: number | null;
  /** Volatilidade anual: √12 × desvio-padrão mensal (amostral). */
  volatility: number | null;
  unavailable: string | null;
}

/**
 * Anualização aritmética (convenção do modelo média-variância): a média mensal
 * multiplica por 12 e a variância também (σ por √12).
 */
export function annualizedStats(periods: PeriodReturn[], minMonths = MIN_MONTHS): AnnualizedStats {
  const rows = periods.filter((p) => Number.isFinite(p.r));
  const months = rows.length;
  const from = rows[0]?.from ?? null;
  const to = rows[months - 1]?.to ?? null;
  if (months < minMonths) {
    return {
      months,
      from,
      to,
      meanMonthly: null,
      volMonthly: null,
      expectedReturn: null,
      volatility: null,
      unavailable: `Histórico insuficiente: ${months} ${months === 1 ? "mês" : "meses"} completos de ${minMonths} necessários.`,
    };
  }
  const mean = rows.reduce((s, p) => s + p.r, 0) / months;
  const variance = rows.reduce((s, p) => s + (p.r - mean) ** 2, 0) / (months - 1);
  const volMonthly = Math.sqrt(variance);
  return {
    months,
    from,
    to,
    meanMonthly: mean,
    volMonthly,
    expectedReturn: mean * 12,
    volatility: volMonthly * Math.sqrt(12),
    unavailable: null,
  };
}

/* ------------------------------------------------------------------ */
/* Utilidade média-variância                                           */
/* ------------------------------------------------------------------ */

/** U = E(r) − ½·A·σ². */
export function utility(expected: number, volatility: number, a: number): number {
  return expected - 0.5 * a * volatility * volatility;
}

/** y* = (E(r) − rf) / (A·σ²); null quando A ou σ não permitem calcular. */
export function optimalRiskyShare(
  expected: number,
  volatility: number,
  riskFree: number,
  a: number,
): number | null {
  const variance = volatility * volatility;
  if (!(a > 0) || !(variance > 0) || !Number.isFinite(expected) || !Number.isFinite(riskFree)) {
    return null;
  }
  return (expected - riskFree) / (a * variance);
}

/**
 * Utilidade da carteira completa com uma fração y em risco e o resto à taxa
 * sem risco: U(y) = rf + y·(E(r) − rf) − ½·A·y²·σ².
 */
export function portfolioUtility(
  y: number,
  expected: number,
  volatility: number,
  riskFree: number,
  a: number,
): number {
  return riskFree + y * (expected - riskFree) - 0.5 * a * y * y * volatility * volatility;
}

/** Sem alavancagem nem vendas a descoberto: entre 0 e 100 %. */
export function clampShare(y: number): number {
  return Math.min(1, Math.max(0, y));
}

/* ------------------------------------------------------------------ */
/* Pesos atuais: risco vs. defensivo                                   */
/* ------------------------------------------------------------------ */

export interface RiskClassWeight {
  class: AssetClass;
  label: string;
  value: number;
  risky: boolean;
}

export interface RiskWeights {
  /** Valor em ações, ETFs e REITs. */
  risky: number;
  /** Valor em P2P e metais, mais a liquidez indicada. */
  defensive: number;
  outsideCash: number;
  total: number;
  /** Peso dos ativos de risco no total (fração), null sem valor. */
  riskyShare: number | null;
  byClass: RiskClassWeight[];
}

export function riskWeights(assets: Asset[], outsideCash = 0): RiskWeights {
  const cash = Number.isFinite(outsideCash) && outsideCash > 0 ? outsideCash : 0;
  const open = assets.filter(isOpenPosition);
  const byClass = CLASS_ORDER.map((c) => ({
    class: c,
    label: CLASS_LABELS[c],
    value: open.filter((a) => a.class === c).reduce((s, a) => s + assetCurrentValue(a), 0),
    risky: RISKY.has(c),
  })).filter((r) => r.value > 0);
  const risky = byClass.filter((r) => r.risky).reduce((s, r) => s + r.value, 0);
  const defensive = byClass.filter((r) => !r.risky).reduce((s, r) => s + r.value, 0) + cash;
  const total = risky + defensive;
  return {
    risky,
    defensive,
    outsideCash: cash,
    total,
    riskyShare: total > 0 ? risky / total : null,
    byClass,
  };
}

/* ------------------------------------------------------------------ */
/* Resultado e leitura                                                 */
/* ------------------------------------------------------------------ */

export interface RiskModelInput {
  a: number;
  expected: number | null;
  volatility: number | null;
  riskFree: number;
  riskyShare: number | null;
}

export type RiskGap = "above" | "below" | "aligned" | "unavailable";

export interface RiskModelResult {
  /** U da parte de risco tal como está (100 % em risco). */
  utility: number | null;
  /** y* sem limites (pode ser < 0 ou > 1). */
  yStar: number | null;
  /** y* limitado a [0, 1]: sem alavancagem nem vendas a descoberto. */
  yTarget: number | null;
  /** Peso atual menos yTarget, em pontos percentuais. */
  gapPp: number | null;
  gap: RiskGap;
  /** U da carteira completa com o peso atual e com yTarget. */
  utilityCurrent: number | null;
  utilityTarget: number | null;
}

/** Diferença (em pp) abaixo da qual o peso atual conta como "próximo" do modelo. */
export const ALIGNED_PP = 5;

export function riskModel(input: RiskModelInput): RiskModelResult {
  const { a, expected, volatility, riskFree, riskyShare } = input;
  if (expected == null || volatility == null) {
    return {
      utility: null,
      yStar: null,
      yTarget: null,
      gapPp: null,
      gap: "unavailable",
      utilityCurrent: null,
      utilityTarget: null,
    };
  }
  const yStar = optimalRiskyShare(expected, volatility, riskFree, a);
  const yTarget = yStar == null ? null : clampShare(yStar);
  const gapPp = yTarget != null && riskyShare != null ? (riskyShare - yTarget) * 100 : null;
  const gap: RiskGap =
    gapPp == null
      ? "unavailable"
      : Math.abs(gapPp) <= ALIGNED_PP
        ? "aligned"
        : gapPp > 0
          ? "above"
          : "below";
  return {
    utility: utility(expected, volatility, a),
    yStar,
    yTarget,
    gapPp,
    gap,
    utilityCurrent:
      riskyShare == null ? null : portfolioUtility(riskyShare, expected, volatility, riskFree, a),
    utilityTarget:
      yTarget == null ? null : portfolioUtility(yTarget, expected, volatility, riskFree, a),
  };
}

/** y* para cada escalão da tabela de conversão, com os mesmos E(r), σ e rf. */
export function sensitivityByAversion(
  expected: number | null,
  volatility: number | null,
  riskFree: number,
): Array<AversionBand & { yStar: number | null }> {
  return AVERSION_TABLE.map((b) => ({
    ...b,
    yStar:
      expected == null || volatility == null
        ? null
        : optimalRiskyShare(expected, volatility, riskFree, b.a),
  }));
}

const share = (y: number) => formatPct(y * 100, 0);

/**
 * O que o resultado significa, em texto simples. Descreve, não recomenda:
 * nunca diz para comprar ou vender.
 */
export function describeRiskModel(
  input: RiskModelInput & { months: number },
  result: RiskModelResult,
): string[] {
  const { a, expected, riskFree, riskyShare, months } = input;
  if (expected == null || result.yStar == null) {
    return [
      "Ainda não há meses completos suficientes nas fotografias para estimar o retorno e a volatilidade da parte de risco.",
    ];
  }
  const lines: string[] = [];
  const target = result.yTarget ?? 0;

  if (expected <= riskFree) {
    lines.push(
      `No período analisado, a parte de risco rendeu ${formatPct(expected * 100, 1)} ao ano, abaixo da taxa sem risco (${formatPct(riskFree * 100, 1)}). Com estes números o modelo não atribui nada aos ativos de risco — reflete o período usado, não uma previsão.`,
    );
  } else if (result.yStar > 1) {
    lines.push(
      `Para A = ${a}, o modelo chegaria a ${share(result.yStar)} em ativos de risco, o que só seria possível com dinheiro emprestado; sem alavancagem, o máximo é ${share(1)}.`,
    );
  } else {
    lines.push(
      `Para A = ${a}, o modelo indica ${share(result.yStar)} da carteira em ativos de risco e o resto em ativos sem risco.`,
    );
  }

  if (riskyShare != null && result.gapPp != null) {
    const now = share(riskyShare);
    if (result.gap === "aligned") {
      lines.push(
        `Hoje tens ${now} em ações, ETFs e REITs, perto do que o modelo indica (${share(target)}).`,
      );
    } else if (result.gap === "above") {
      lines.push(
        `Hoje tens ${now} em ações, ETFs e REITs, ${formatPp(result.gapPp, 0)} acima do modelo (${share(target)}). Segundo este modelo, a carteira assume mais risco do que o teu perfil sugere.`,
      );
    } else {
      lines.push(
        `Hoje tens ${now} em ações, ETFs e REITs, ${formatPp(result.gapPp, 0)} abaixo do modelo (${share(target)}). Segundo este modelo, a carteira assume menos risco do que o teu perfil admitiria.`,
      );
    }
  }

  lines.push(
    `O modelo assume que os próximos anos se parecem com os ${months} meses analisados e trata P2P, metais e liquidez como se fossem um ativo sem risco (não são). É uma forma de pensar no risco, não uma recomendação.`,
  );
  return lines;
}

/* ------------------------------------------------------------------ */
/* Pressupostos (formulário)                                           */
/* ------------------------------------------------------------------ */

/** Pressupostos do modelo, tal como escritos (texto, vírgula decimal). */
export interface RiskInputsForm {
  /** Taxa sem risco anual, em %. */
  riskFree: string;
  /** Liquidez fora da carteira, em EUR. */
  outsideCash: string;
  /** Retorno esperado anual da parte de risco, em %; vazio = histórico. */
  expectedReturn: string;
}

export type RiskInputsErrors = Partial<Record<keyof RiskInputsForm, string>>;

/** Mesmas regras do servidor (`saveInvestorProfile`) e da tabela `investor_profiles`. */
export function validateRiskInputs(f: RiskInputsForm): RiskInputsErrors {
  const e: RiskInputsErrors = {};
  const rf = parseNumberPt(f.riskFree);
  if (!(rf >= -5 && rf <= 20)) e.riskFree = "Usa um valor entre -5 e 20.";
  if (f.outsideCash.trim() !== "") {
    const cash = parseNumberPt(f.outsideCash);
    if (!(cash >= 0 && cash < 1e9)) e.outsideCash = "Indica um valor em euros, 0 ou mais.";
  }
  if (f.expectedReturn.trim() !== "") {
    const er = parseNumberPt(f.expectedReturn);
    if (!(er > -50 && er < 50)) e.expectedReturn = "Usa um valor entre -50 e 50, ou deixa vazio.";
  }
  return e;
}

export interface RiskInputs {
  riskFreePct: number;
  outsideCash: number;
  /** null = usar o retorno histórico. */
  expectedReturnPct: number | null;
}

/** Converte o formulário (já validado) em números; campos vazios usam o valor por omissão. */
export function parseRiskInputs(f: RiskInputsForm, riskFreeDefault = 2): RiskInputs {
  const rf = parseNumberPt(f.riskFree);
  const cash = parseNumberPt(f.outsideCash);
  const er = f.expectedReturn.trim() === "" ? Number.NaN : parseNumberPt(f.expectedReturn);
  return {
    riskFreePct: Number.isFinite(rf) ? rf : riskFreeDefault,
    outsideCash: Number.isFinite(cash) && cash > 0 ? cash : 0,
    expectedReturnPct: Number.isFinite(er) ? er : null,
  };
}
