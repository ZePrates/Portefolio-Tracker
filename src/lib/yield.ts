/**
 * Estimativa pura de dividendos anuais — determinística, sem rede e sem LLM.
 *
 * Problema: fontes de dados (ex.: Yahoo Finance) falham pagamentos no último ano.
 * Somar apenas o que aparece subestima o yield (ex.: ACN mostrava 1,8% em vez de ~3,6%).
 *
 * Estratégia: inferir a cadência (mensal/trimestral/semestral/anual) a partir dos
 * intervalos entre ex-dates de TODO o histórico. Se o último ano tem menos
 * pagamentos do que a cadência espera, anualiza-se o dividendo mais recente.
 * Caso contrário, usa-se a soma real dos últimos 12 meses. Nunca se inventam dados.
 */

export interface DividendEvent {
  /** Ex-date em ISO (yyyy-mm-dd). */
  date: string;
  amount: number;
}

const DAY_MS = 86_400_000;
/** Cadências reconhecidas: mensal, trimestral, semestral, anual. */
const CADENCES = [12, 4, 2, 1] as const;
/** Tolerância de encaixe na cadência (pagamentos/ano). */
const MAX_CADENCE_ERROR = 1.25;

function last12Months(dividends: DividendEvent[], now: Date): DividendEvent[] {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const iso = cutoff.toISOString().slice(0, 10);
  return dividends
    .filter((d) => d.date >= iso)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Intervalos recentes usados para detetar a cadência atual. */
const RECENT_INTERVALS = 4;

function paymentIntervals(dividends: DividendEvent[]): number[] | null {
  const dates = [...new Set(dividends.map((d) => d.date))].sort();
  if (dates.length < 3) return null;
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const curr = dates[i];
    if (!prev || !curr) continue;
    const days = (Date.parse(curr) - Date.parse(prev)) / DAY_MS;
    // Ignora intervalos curtos (ex.: pagamentos especiais colados ao regular).
    if (days >= 20) intervals.push(days);
  }
  return intervals;
}

/** Cadência de TODO o histórico (sem dar prioridade aos pagamentos recentes). */
function historicalPaymentsPerYear(dividends: DividendEvent[]): number | null {
  const intervals = paymentIntervals(dividends);
  return intervals ? cadenceOf(intervals) : null;
}

/**
 * Infere pagamentos por ano (12/4/2/1). Dá prioridade à cadência dos
 * pagamentos mais recentes, para apanhar mudanças de política (ex.: STAG
 * passou de mensal a trimestral em 2026); se os intervalos recentes forem
 * irregulares, recai no histórico completo. Null quando não é possível inferir.
 */
export function inferPaymentsPerYear(dividends: DividendEvent[]): number | null {
  const intervals = paymentIntervals(dividends);
  if (!intervals) return null;
  if (intervals.length >= 3) {
    const recent = cadenceOf(intervals.slice(-RECENT_INTERVALS));
    if (recent != null) return recent;
  }
  return cadenceOf(intervals);
}

function cadenceOf(intervals: number[]): number | null {
  if (intervals.length === 0) return null;
  // Mediana: robusta a gaps deixados por pagamentos em falta na fonte.
  const sorted = [...intervals].sort((a, b) => a - b);
  const midIdx = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[midIdx] ?? 0)
      : ((sorted[midIdx - 1] ?? 0) + (sorted[midIdx] ?? 0)) / 2;
  if (!(median > 0)) return null;
  const perYear = 365.25 / median;
  let best: number | null = null;
  let bestErr = Infinity;
  for (const c of CADENCES) {
    const err = Math.abs(perYear - c);
    if (err < bestErr) {
      bestErr = err;
      best = c;
    }
  }
  return best !== null && bestErr <= MAX_CADENCE_ERROR ? best : null;
}

/** Soma real dos dividendos com ex-date nos últimos 12 meses. */
export function ttmDividends(dividends: DividendEvent[], now: Date = new Date()): number {
  return last12Months(dividends, now).reduce((s, d) => s + d.amount, 0);
}

/**
 * Estimativa do dividendo anual por ação:
 * - mudança de cadência (recente ≠ histórica) → dividendo mais recente × cadência atual,
 *   porque a soma dos últimos 12 meses mistura os dois regimes;
 * - último ano completo face à cadência → soma real (TTM);
 * - pagamentos em falta → dividendo mais recente × cadência;
 * - sem dados → null (nunca inventar).
 */
export function estimateAnnualDividend(
  dividends: DividendEvent[],
  now: Date = new Date(),
): number | null {
  const last12 = last12Months(dividends, now);
  if (last12.length === 0) return null;
  const ttm = last12.reduce((s, d) => s + d.amount, 0);
  const perYear = inferPaymentsPerYear(dividends);
  if (perYear == null) return ttm;
  const latest = last12[last12.length - 1];
  const historical = historicalPaymentsPerYear(dividends);
  const cadenceChanged = historical != null && historical !== perYear;
  if (!cadenceChanged && last12.length >= perYear) return ttm;
  if (!latest || !(latest.amount > 0)) return ttm;
  return latest.amount * perYear;
}

/** Yield anual em % face ao preço atual. Null quando não é calculável. */
export function annualYieldPercent(
  dividends: DividendEvent[],
  price: number,
  now: Date = new Date(),
): number | null {
  if (!(price > 0)) return null;
  const annual = estimateAnnualDividend(dividends, now);
  if (annual == null || annual <= 0) return null;
  return (annual / price) * 100;
}

/** Rótulo de frequência a partir da cadência inferida. */
export function frequencyLabel(paymentsPerYear: number | null): string | null {
  switch (paymentsPerYear) {
    case 12:
      return "Mensal";
    case 4:
      return "Trimestral";
    case 2:
      return "Semestral";
    case 1:
      return "Anual";
    default:
      return null;
  }
}
