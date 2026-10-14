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
  annualReturnPct = SP500_ANNUAL_RETURN_PCT,
): BenchmarkComparison | null {
  const flows = cashFlowsFromLedger(transactions).filter((f) => f.date <= today);
  if (flows.length === 0) return null;

  const ids = new Set(transactions.map((t) => t.asset_id).filter(Boolean));
  const portfolioValue = assets
    .filter((a) => ids.has(a.id) && isOpenPosition(a))
    .reduce((s, a) => s + assetCurrentValue(a), 0);
  const divs = dividends
    .filter((d) => d.asset_id != null && ids.has(d.asset_id) && isReceived(d, today))
    .reduce((s, d) => s + netOf(d), 0);

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
    series.push({ date: stop, invested, benchmark: value });
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
