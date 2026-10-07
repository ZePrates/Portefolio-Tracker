/**
 * Alocação vs objetivo e rebalanceamento por aportes (core-satellite) — puro.
 * O rebalanceamento sugerido nunca vende: reparte o novo aporte pelas
 * posições abaixo do alvo, o que evita realizar mais-valias (eficiente em IRS).
 */

export interface AllocationSliceInput {
  key: string;
  label: string;
  value: number;
}

export interface AllocationTargetInput {
  key: string;
  /** Peso-alvo em % (0..100). */
  targetPct: number;
}

export interface DriftRow {
  key: string;
  label: string;
  value: number;
  currentPct: number;
  targetPct: number;
  /** Desvio em pontos percentuais (atual − alvo). */
  driftPct: number;
  /** Desvio em EUR face ao valor-alvo (positivo = acima do alvo). */
  driftValue: number;
}

export interface DriftReport {
  rows: DriftRow[];
  total: number;
  /** Soma dos alvos definidos (deve ser 100). */
  targetSum: number;
  /** Maior desvio absoluto, em pontos percentuais. */
  maxAbsDrift: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Normaliza os alvos para somarem 100 (quando somam > 0). */
function normalizedTargets(targets: AllocationTargetInput[]): Map<string, number> {
  const sum = targets.reduce((s, t) => s + Math.max(0, t.targetPct), 0);
  return new Map(targets.map((t) => [t.key, sum > 0 ? (Math.max(0, t.targetPct) / sum) * 100 : 0]));
}

export function allocationDrift(
  slices: AllocationSliceInput[],
  targets: AllocationTargetInput[],
): DriftReport {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const norm = normalizedTargets(targets);
  const labels = new Map(slices.map((s) => [s.key, s.label]));
  const keys = [...new Set([...slices.map((s) => s.key), ...targets.map((t) => t.key)])];
  const valueOf = new Map(slices.map((s) => [s.key, Math.max(0, s.value)]));

  const rows = keys
    .map((key) => {
      const value = valueOf.get(key) ?? 0;
      const currentPct = total > 0 ? (value / total) * 100 : 0;
      const targetPct = norm.get(key) ?? 0;
      return {
        key,
        label: labels.get(key) ?? key,
        value,
        currentPct,
        targetPct,
        driftPct: currentPct - targetPct,
        driftValue: round2(value - (targetPct / 100) * total),
      };
    })
    .sort((a, b) => b.targetPct - a.targetPct || b.value - a.value);

  return {
    rows,
    total,
    targetSum: targets.reduce((s, t) => s + t.targetPct, 0),
    maxAbsDrift: rows.reduce((m, r) => Math.max(m, Math.abs(r.driftPct)), 0),
  };
}

export interface ContributionSuggestion {
  key: string;
  label: string;
  amount: number;
}

/**
 * Reparte `contribution` (EUR) sem vender: primeiro tapa os défices face ao
 * alvo após o aporte (proporcionalmente ao défice); o que sobrar segue os pesos-alvo.
 */
export function contributionPlan(
  slices: AllocationSliceInput[],
  targets: AllocationTargetInput[],
  contribution: number,
): ContributionSuggestion[] {
  if (!(contribution > 0) || targets.length === 0) return [];
  const norm = normalizedTargets(targets);
  const valueOf = new Map(slices.map((s) => [s.key, Math.max(0, s.value)]));
  const labels = new Map(slices.map((s) => [s.key, s.label]));
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0) + contribution;

  const deficits = [...norm.entries()].map(([key, pct]) => ({
    key,
    pct,
    deficit: Math.max(0, (pct / 100) * total - (valueOf.get(key) ?? 0)),
  }));
  const totalDeficit = deficits.reduce((s, d) => s + d.deficit, 0);

  const raw = deficits.map((d) => {
    if (totalDeficit >= contribution) {
      return {
        key: d.key,
        amount: totalDeficit > 0 ? (d.deficit / totalDeficit) * contribution : 0,
      };
    }
    const remainder = contribution - totalDeficit;
    return { key: d.key, amount: d.deficit + (d.pct / 100) * remainder };
  });

  // Arredonda ao cêntimo garantindo que a soma bate certo com o aporte.
  const rounded = raw.map((r) => ({ ...r, amount: Math.floor(r.amount * 100) / 100 }));
  let diff = Math.round((contribution - rounded.reduce((s, r) => s + r.amount, 0)) * 100);
  for (const r of rounded.sort((a, b) => b.amount - a.amount)) {
    if (diff <= 0) break;
    r.amount = round2(r.amount + 0.01);
    diff -= 1;
  }
  return rounded
    .filter((r) => r.amount > 0)
    .map((r) => ({ key: r.key, label: labels.get(r.key) ?? r.key, amount: r.amount }))
    .sort((a, b) => b.amount - a.amount);
}
