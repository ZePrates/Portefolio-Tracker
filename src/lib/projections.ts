/**
 * Fase 8 — Projeções de carteira.
 *
 * Camada PURA e determinística. Não altera posições, transações ou dividendos,
 * não faz chamadas externas e não representa uma previsão garantida.
 * Os valores futuros são apenas simulações com os pressupostos fornecidos.
 */

export type ProjectionScenario = "conservative" | "base" | "optimistic";

export interface ProjectionScenarioConfig {
  key: ProjectionScenario;
  label: string;
  annualReturnPct: number;
}

export const DEFAULT_SCENARIOS: ProjectionScenarioConfig[] = [
  { key: "conservative", label: "Conservador", annualReturnPct: 3 },
  { key: "base", label: "Base", annualReturnPct: 6 },
  { key: "optimistic", label: "Optimista", annualReturnPct: 9 },
];

export const PROJECTION_HORIZONS = [1, 5, 10, 20, 30] as const;

export interface ProjectionInput {
  currentValue: number;
  monthlyContribution: number;
  annualReturnPct: number;
  years: number;
  startDate?: Date | string;
}

export interface ProjectionPoint {
  month: number;
  date: string;
  invested: number;
  value: number;
  gains: number;
}

export interface ProjectionSummary {
  years: number;
  final: ProjectionPoint;
  points: ProjectionPoint[];
}

export interface GoalProjection {
  target: number;
  reached: boolean;
  month: number | null;
  date: string | null;
  year: number | null;
  valueAtEnd: number;
}

const safeNumber = (value: number) => (Number.isFinite(value) ? value : 0);

function monthDate(start: Date, month: number): string {
  const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  date.setUTCMonth(date.getUTCMonth() + month);
  return date.toISOString().slice(0, 10);
}

/** Projeta mês a mês; o aporte entra no fim de cada mês. */
export function projectPortfolio(input: ProjectionInput): ProjectionSummary {
  const currentValue = Math.max(0, safeNumber(input.currentValue));
  const monthlyContribution = Math.max(0, safeNumber(input.monthlyContribution));
  const years = Math.max(0, safeNumber(input.years));
  const months = Math.round(years * 12);
  const annualReturn = Math.max(-1, safeNumber(input.annualReturnPct) / 100);
  const monthlyRate = Math.pow(1 + annualReturn, 1 / 12) - 1;
  const start = input.startDate ? new Date(input.startDate) : new Date();
  const startDate = Number.isNaN(start.getTime()) ? new Date() : start;

  let value = currentValue;
  const points: ProjectionPoint[] = [
    { month: 0, date: monthDate(startDate, 0), invested: currentValue, value, gains: 0 },
  ];

  for (let month = 1; month <= months; month += 1) {
    value *= 1 + monthlyRate;
    value += monthlyContribution;
    const invested = currentValue + monthlyContribution * month;
    points.push({
      month,
      date: monthDate(startDate, month),
      invested,
      value,
      gains: value - invested,
    });
  }

  return { years, final: points[points.length - 1]!, points };
}

export function finalProjection(input: ProjectionInput): ProjectionPoint {
  return projectPortfolio(input).final;
}

/** Encontra o primeiro mês em que a simulação atinge o objetivo. */
export function goalProjection(
  input: Omit<ProjectionInput, "years"> & { maxYears?: number },
  target: number,
): GoalProjection {
  const safeTarget = Math.max(0, safeNumber(target));
  const summary = projectPortfolio({ ...input, years: input.maxYears ?? 30 });
  const hit = summary.points.find((point) => point.value >= safeTarget);

  return {
    target: safeTarget,
    reached: Boolean(hit),
    month: hit?.month ?? null,
    date: hit?.date ?? null,
    year: hit ? Math.ceil(hit.month / 12) : null,
    valueAtEnd: summary.final.value,
  };
}

/** Simula crescimento por classe sem alterar dados reais. */
export function futureValueByClass(
  values: Record<string, number>,
  monthlyContributions: Record<string, number>,
  annualReturnPct: number,
  years: number,
): Record<string, number> {
  return Object.fromEntries(
    Object.keys(values).map((key) => [
      key,
      finalProjection({
        currentValue: values[key] ?? 0,
        monthlyContribution: monthlyContributions[key] ?? 0,
        annualReturnPct,
        years,
      }).value,
    ]),
  );
}
