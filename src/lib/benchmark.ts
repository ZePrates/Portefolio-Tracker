/**
 * Carteira vs. benchmark hipotético: os mesmos aportes e levantamentos do
 * ledger, nas mesmas datas, aplicados a um índice com retorno anual fixo
 * (por omissão o S&P 500 a 10,56 %/ano, com dividendos reinvestidos).
 *
 * Lógica pura. Só entram os ativos com movimentos no ledger, para que o
 * valor da carteira e os fluxos comparados digam respeito aos mesmos ativos
 * (ex.: P2P sem transações fica de fora).
 */

import { isReceived, netOf, type DividendRecord } from "@/lib/dividends";
import { cashFlowsFromLedger, type PerfTransaction } from "@/lib/performance";
import { assetCurrentValue, isOpenPosition, type Asset } from "@/lib/portfolio-types";

/** Retorno anual assumido para o S&P 500 (nominal, dividendos reinvestidos). */
export const SP500_ANNUAL_RETURN_PCT = 10.56;

const DAY_MS = 86_400_000;

export interface BenchmarkPoint {
  /** Fim do mês (YYYY-MM-DD) ou hoje no último ponto. */
  date: string;
  /** Capital líquido aportado até à data. */
  invested: number;
  /** Valor do benchmark com os mesmos fluxos. */
  benchmark: number;
  /**
   * Valor da carteira (+ dividendos recebidos até à data), da última
   * fotografia do mês; null quando não há fotografia nesse mês.
   */
  portfolio: number | null;
}

/** Fotografia diária da carteira (ver snapshots.functions). */
export interface BenchmarkSnapshot {
  snapshotDate: string;
  scope: string;
  marketValue: number | null;
}

export interface BenchmarkComparison {
  annualReturnPct: number;
  /** Valor atual dos ativos com movimentos + dividendos líquidos recebidos. */
  portfolio: number;
  portfolioValue: number;
  dividends: number;
  benchmark: number;
  invested: number;
  /** Carteira − benchmark (positivo = carteira à frente). */
  difference: number;
  differencePct: number | null;
  firstDate: string;
  series: BenchmarkPoint[];
}

function days(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
}

function monthEnd(date: string): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Valor do benchmark em `date`, partindo de `value` em `from`. */
function grow(value: number, from: string, to: string, annual: number): number {
  return value * Math.pow(1 + annual, Math.max(0, days(from, to)) / 365);
}

export function benchmarkComparison(
  assets: Asset[],
  transactions: PerfTransaction[],
  dividends: DividendRecord[],
  today: string,
  snapshots: BenchmarkSnapshot[] = [],
  annualReturnPct = SP500_ANNUAL_RETURN_PCT,
): BenchmarkComparison | null {
  const flows = cashFlowsFromLedger(transactions).filter((f) => f.date <= today);
  if (flows.length === 0) return null;

  const ids = new Set(transactions.map((t) => t.asset_id).filter(Boolean));
  const portfolioValue = assets
    .filter((a) => ids.has(a.id) && isOpenPosition(a))
    .reduce((s, a) => s + assetCurrentValue(a), 0);
  const ledgerDivs = dividends
    .filter((d) => d.asset_id != null && ids.has(d.asset_id) && isReceived(d, today))
    .map((d) => ({ date: (d.payment_date ?? d.paid_at).slice(0, 10), amount: netOf(d) }));
  const divs = ledgerDivs.reduce((s, d) => s + d.amount, 0);
  const divsUntil = (date: string) =>
    ledgerDivs.filter((d) => d.date <= date).reduce((s, d) => s + d.amount, 0);
  const history = snapshotValues(
    snapshots,
    new Set(assets.filter((a) => ids.has(a.id)).map((a) => a.class)),
  );

  const annual = annualReturnPct / 100;
  const series: BenchmarkPoint[] = [];
  let value = 0;
  let invested = 0;
  let at = flows[0]!.date;
  let i = 0;
  // Pontos ao fim de cada mês, desde o primeiro aporte até hoje.
  for (let end = monthEnd(at); ; end = monthEnd(addDays(end, 1))) {
    const stop = end < today ? end : today;
    while (i < flows.length && flows[i]!.date <= stop) {
      const f = flows[i]!;
      value = grow(value, at, f.date, annual) + f.amount;
      invested += f.amount;
      at = f.date;
      i++;
    }
    value = grow(value, at, stop, annual);
    at = stop;
    const portfolio = portfolioValue + divs;
    let point: number | null = stop === today ? portfolio : null;
    if (point == null) {
      const snap = lastInMonth(history, stop);
      if (snap) point = snap.value + divsUntil(snap.date);
    }
    series.push({ date: stop, invested, benchmark: value, portfolio: point });
    if (stop === today) break;
  }

  const portfolio = portfolioValue + divs;
  const difference = portfolio - value;
  return {
    annualReturnPct,
    portfolio,
    portfolioValue,
    dividends: divs,
    benchmark: value,
    invested,
    difference,
    differencePct: value > 0 ? (difference / value) * 100 : null,
    firstDate: flows[0]!.date,
    series,
  };
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Valor por data a partir das fotografias da app: soma das classes que têm
 * movimentos no ledger. Só usa datas com fotografia "total" (as da app
 * gravam todas as classes nesse dia; históricos importados só de uma classe
 * ficam de fora para não mostrar uma carteira incompleta).
 */
function snapshotValues(
  snapshots: BenchmarkSnapshot[],
  classes: Set<string>,
): Array<{ date: string; value: number }> {
  const totals = new Set(
    snapshots
      .filter((s) => s.scope === "total" && s.marketValue != null)
      .map((s) => s.snapshotDate),
  );
  const byDate = new Map<string, number>();
  for (const s of snapshots) {
    if (!totals.has(s.snapshotDate) || s.marketValue == null) continue;
    if (!s.scope.startsWith("class:") || !classes.has(s.scope.slice(6))) continue;
    byDate.set(s.snapshotDate, (byDate.get(s.snapshotDate) ?? 0) + s.marketValue);
  }
  return [...byDate.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Última fotografia do mês de `monthEndDate` (até essa data). */
function lastInMonth(
  history: Array<{ date: string; value: number }>,
  monthEndDate: string,
): { date: string; value: number } | null {
  const month = monthEndDate.slice(0, 7);
  let found: { date: string; value: number } | null = null;
  for (const h of history) {
    if (h.date.slice(0, 7) === month && h.date <= monthEndDate) found = h;
  }
  return found;
}
