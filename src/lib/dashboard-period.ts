/**
 * Variação da carteira num período (cartão principal do Dashboard).
 *
 * Só compõe funções já existentes (`twr`, `twrFlows`, `valuationsFromSnapshots`):
 * não introduz regras financeiras novas. O valor de partida vem sempre de uma
 * fotografia real; sem fotografia anterior ao fim do período, devolve `null`
 * em vez de estimar.
 */

import type { DividendRecord } from "@/lib/dividends";
import {
  twr,
  twrFlows,
  valuationsFromSnapshots,
  type PerfTransaction,
  type ValuationPoint,
} from "@/lib/performance";
import type { DateRange } from "@/lib/dashboard";

export interface SnapshotLike {
  snapshotDate: string;
  scope: string;
  investedAmount: number;
  marketValue: number | null;
}

export interface PeriodChange {
  /** Ganho em EUR no período (já sem aportes/levantamentos). */
  amount: number;
  /** Retorno percentual do período (TWR; no período total, rentabilidade total). */
  pct: number | null;
  /** Data da fotografia de partida; `null` no período total (usa o ledger). */
  baselineDate: string | null;
}

/** Fotografia de partida: a última antes do período, ou a primeira dentro dele. */
export function baselineFor(
  valuations: ValuationPoint[],
  range: DateRange,
  today: string,
): ValuationPoint | null {
  const before = valuations.filter((v) => v.date < range.from);
  const base =
    before.length > 0 ? before[before.length - 1]! : valuations.find((v) => v.date >= range.from);
  return base && base.date < today ? base : null;
}

export function periodChange({
  isAll,
  range,
  today,
  currentValue,
  totalResult,
  totalReturnPct,
  snapshots,
  transactions,
  dividends,
}: {
  /** Período "Tudo": usa o resultado total do ledger em vez de fotografias. */
  isAll: boolean;
  range: DateRange;
  today: string;
  currentValue: number;
  totalResult: number;
  totalReturnPct: number | null;
  snapshots: SnapshotLike[];
  transactions: PerfTransaction[];
  dividends: DividendRecord[];
}): PeriodChange | null {
  if (isAll) return { amount: totalResult, pct: totalReturnPct, baselineDate: null };

  const valuations = valuationsFromSnapshots(snapshots, "total");
  const base = baselineFor(valuations, range, today);
  if (!base) return null;

  const flows = twrFlows(transactions, dividends, today).filter(
    (f) => f.date > base.date && f.date <= today,
  );
  const flowSum = flows.reduce((s, f) => s + f.amount, 0);
  const points: ValuationPoint[] = [
    ...valuations.filter((v) => v.date >= base.date && v.date < today),
    { date: today, value: currentValue },
  ];
  return {
    amount: currentValue - base.value - flowSum,
    pct: twr(points, flows).totalPct,
    baselineDate: base.date,
  };
}

export interface HeroPoint {
  date: string;
  marketValue: number;
  invested: number;
}

/** Série do gráfico: fotografias diárias do total dentro do período (com a de partida). */
export function heroSeries(
  snapshots: SnapshotLike[],
  range: DateRange,
  today: string,
): HeroPoint[] {
  const total = snapshots
    .filter((s) => s.scope === "total" && s.marketValue != null && Number.isFinite(s.marketValue))
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  const valuations = total.map((s) => ({ date: s.snapshotDate, value: Number(s.marketValue) }));
  const base = baselineFor(valuations, range, today);
  const from = base ? base.date : range.from;
  return total
    .filter((s) => s.snapshotDate >= from)
    .map((s) => ({
      date: s.snapshotDate,
      marketValue: Number(s.marketValue),
      invested: s.investedAmount,
    }));
}
