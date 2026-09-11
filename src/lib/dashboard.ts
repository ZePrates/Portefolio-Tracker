/**
 * Métricas consolidadas do Dashboard — lógica pura e testável.
 * Reutiliza as regras já existentes (posições/FIFO em portfolio-types,
 * elegibilidade de dividendos em dividends.ts). Não faz chamadas externas
 * e nunca usa LLM: só agrega dados persistidos.
 */

import {
  type Asset,
  type AssetClass,
  CLASS_LABELS,
  assetCurrentValue,
  assetInvested,
  isOpenPosition,
} from "@/lib/portfolio-types";
import { isReceived, netOf, type DividendRecord } from "@/lib/dividends";

export type PeriodKey = "today" | "month" | "ytd" | "1y" | "all" | "custom";

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Hoje",
  month: "Mês",
  ytd: "YTD",
  "1y": "1 ano",
  all: "Todo o período",
  custom: "Personalizado",
};

export interface DateRange {
  from: string;
  to: string;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** Intervalo de datas de um período. "all" começa em 1970-01-01. */
export function periodRange(period: PeriodKey, today = todayISO(), custom?: DateRange): DateRange {
  if (period === "custom" && custom) return custom;
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "1y":
      return { from: shiftYears(today, -1), to: today };
    default:
      return { from: "1970-01-01", to: today };
  }
}

export function inRange(date: string | null | undefined, range: DateRange): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  return d >= range.from && d <= range.to;
}

/* ------------------------------------------------------------------ */
/* KPIs                                                                */
/* ------------------------------------------------------------------ */

export interface TransactionLike {
  type: string;
  traded_at: string;
  realized_pl?: number | null;
  fee?: number | null;
}

export interface PortfolioSummary {
  /** Valor de mercado atual das posições abertas, em EUR. */
  currentValue: number;
  /** Custo das unidades ainda detidas (cost basis atual), em EUR. */
  costBasis: number;
  /** Mais/menos-valias já realizadas (vendas), em EUR. */
  realizedPL: number;
  /** Mais/menos-valias latentes das posições abertas, em EUR. */
  unrealizedPL: number;
  unrealizedPct: number;
  /** Dividendos líquidos efetivamente recebidos, em EUR. */
  dividendsReceived: number;
  /** Dividendos ainda por receber (agendados/projetados), em EUR. */
  dividendsScheduled: number;
  /** realizado + não realizado + dividendos recebidos. */
  totalResult: number;
  /** totalResult / (cost basis + custo das posições fechadas), em %. */
  totalReturnPct: number | null;
  /** Base usada para a rentabilidade total, em EUR. */
  returnBasis: number;
  /** Dividendos dos últimos 12 meses / cost basis atual, em %. */
  yieldOnCost: number | null;
  openPositions: number;
  closedPositions: number;
}

export function portfolioSummary(
  assets: Asset[],
  dividends: DividendRecord[],
  today = todayISO(),
): PortfolioSummary {
  const open = assets.filter(isOpenPosition);
  const closed = assets.filter((a) => !isOpenPosition(a));

  const currentValue = open.reduce((s, a) => s + assetCurrentValue(a), 0);
  const costBasis = open.reduce((s, a) => s + assetInvested(a), 0);
  const realizedPL = assets.reduce((s, a) => s + (Number(a.realized_pl) || 0), 0);
  const unrealizedPL = currentValue - costBasis;
  const dividendsReceived = dividends
    .filter((d) => isReceived(d, today))
    .reduce((s, d) => s + netOf(d), 0);
  const dividendsScheduled = dividends
    .filter((d) => !isReceived(d, today))
    .reduce((s, d) => s + netOf(d), 0);

  const closedCost = closed.reduce((s, a) => s + (Number(a.invested_amount) || 0), 0);
  const returnBasis = costBasis + closedCost;
  const totalResult = realizedPL + unrealizedPL + dividendsReceived;

  const last12 = dividends
    .filter((d) => isReceived(d, today) && (d.payment_date ?? d.paid_at) >= shiftYears(today, -1))
    .reduce((s, d) => s + netOf(d), 0);

  return {
    currentValue,
    costBasis,
    realizedPL,
    unrealizedPL,
    unrealizedPct: costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0,
    dividendsReceived,
    dividendsScheduled,
    totalResult,
    totalReturnPct: returnBasis > 0 ? (totalResult / returnBasis) * 100 : null,
    returnBasis,
    yieldOnCost: costBasis > 0 ? (last12 / costBasis) * 100 : null,
    openPositions: open.length,
    closedPositions: closed.length,
  };
}

/* ------------------------------------------------------------------ */
/* Alocação                                                            */
/* ------------------------------------------------------------------ */

export interface AllocationSlice {
  class: AssetClass;
  label: string;
  value: number;
  pct: number;
  count: number;
}

export function allocationByClass(assets: Asset[]): AllocationSlice[] {
  const open = assets.filter(isOpenPosition);
  const total = open.reduce((s, a) => s + assetCurrentValue(a), 0);
  return (Object.keys(CLASS_LABELS) as AssetClass[])
    .map((c) => {
      const rows = open.filter((a) => a.class === c);
      const value = rows.reduce((s, a) => s + assetCurrentValue(a), 0);
      return {
        class: c,
        label: CLASS_LABELS[c],
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        count: rows.length,
      };
    })
    .filter((x) => x.value > 0 || x.count > 0);
}

/* ------------------------------------------------------------------ */
/* Performance por ativo                                               */
/* ------------------------------------------------------------------ */

export interface AssetPerformance {
  id: string;
  name: string;
  ticker: string | null;
  class: AssetClass;
  value: number;
  invested: number;
  unrealized: number;
  /** Rentabilidade do investidor (custo real das unidades detidas). */
  unrealizedPct: number | null;
  weight: number;
}

export function assetPerformance(assets: Asset[]): AssetPerformance[] {
  const open = assets.filter(isOpenPosition);
  const total = open.reduce((s, a) => s + assetCurrentValue(a), 0);
  return open
    .map((a) => {
      const value = assetCurrentValue(a);
      const invested = assetInvested(a);
      const unrealized = value - invested;
      return {
        id: a.id,
        name: a.name,
        ticker: a.ticker,
        class: a.class,
        value,
        invested,
        unrealized,
        unrealizedPct: invested > 0 ? (unrealized / invested) * 100 : null,
        weight: total > 0 ? (value / total) * 100 : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
}

export function bestPerformers(rows: AssetPerformance[], limit = 5): AssetPerformance[] {
  return rows
    .filter((r) => r.unrealizedPct !== null)
    .sort((a, b) => (b.unrealizedPct ?? 0) - (a.unrealizedPct ?? 0))
    .slice(0, limit);
}

export function worstPerformers(rows: AssetPerformance[], limit = 5): AssetPerformance[] {
  return rows
    .filter((r) => r.unrealizedPct !== null)
    .sort((a, b) => (a.unrealizedPct ?? 0) - (b.unrealizedPct ?? 0))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Evolução temporal (reconstruída do ledger — sem valores inventados)  */
/* ------------------------------------------------------------------ */

export interface TimelinePoint {
  /** Chave do período: YYYY-MM-DD (diário) ou YYYY-MM (mensal). */
  key: string;
  /** Capital investido acumulado (compras − custo das vendas). */
  invested: number;
  /** Mais/menos-valias realizadas acumuladas. */
  realized: number;
  /** Dividendos líquidos acumulados. */
  dividends: number;
}

export interface TimelineTransaction {
  type: string;
  traded_at: string;
  quantity: number;
  price: number;
  fee?: number | null;
  realized_pl?: number | null;
}

export type Granularity = "day" | "month" | "year";

export function granularityFor(period: PeriodKey): Granularity {
  if (period === "today" || period === "month") return "day";
  if (period === "ytd" || period === "1y") return "month";
  return "month";
}

function bucket(date: string, g: Granularity): string {
  if (g === "day") return date.slice(0, 10);
  if (g === "month") return date.slice(0, 7);
  return date.slice(0, 4);
}

/**
 * Série acumulada a partir do ledger real. Não estima valor de mercado
 * histórico (não existem snapshots), apenas fluxos efetivamente registados.
 */
export function buildTimeline(
  transactions: TimelineTransaction[],
  dividends: DividendRecord[],
  range: DateRange,
  g: Granularity,
  today = todayISO(),
): TimelinePoint[] {
  const events: Array<{ date: string; invested: number; realized: number; dividends: number }> = [];

  for (const t of transactions) {
    const fee = Number(t.fee ?? 0) || 0;
    const gross = (Number(t.quantity) || 0) * (Number(t.price) || 0);
    if (t.type === "buy") {
      events.push({ date: t.traded_at, invested: gross + fee, realized: 0, dividends: 0 });
    } else if (t.type === "sell") {
      const realized = Number(t.realized_pl ?? 0) || 0;
      events.push({
        date: t.traded_at,
        invested: -(gross - realized - fee),
        realized,
        dividends: 0,
      });
    }
  }
  for (const d of dividends) {
    if (!isReceived(d, today)) continue;
    events.push({
      date: (d.payment_date ?? d.paid_at).slice(0, 10),
      invested: 0,
      realized: 0,
      dividends: netOf(d),
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  let invested = 0;
  let realized = 0;
  let divs = 0;
  const points = new Map<string, TimelinePoint>();

  for (const e of events) {
    invested += e.invested;
    realized += e.realized;
    divs += e.dividends;
    if (e.date < range.from || e.date > range.to) continue;
    points.set(bucket(e.date, g), {
      key: bucket(e.date, g),
      invested,
      realized,
      dividends: divs,
    });
  }

  return [...points.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/* ------------------------------------------------------------------ */
/* Dividendos                                                          */
/* ------------------------------------------------------------------ */

export interface DividendSummary {
  period: number;
  year: number;
  total: number;
  scheduled: number;
  byAsset: Array<{ assetId: string | null; assetName: string; total: number; count: number }>;
  byMonth: Array<{ key: string; amount: number }>;
}

export function dividendSummary(
  dividends: DividendRecord[],
  range: DateRange,
  today = todayISO(),
): DividendSummary {
  const received = dividends.filter((d) => isReceived(d, today));
  const dateOf = (d: DividendRecord) => (d.payment_date ?? d.paid_at).slice(0, 10);
  const year = today.slice(0, 4);

  const byAssetMap = new Map<
    string,
    { assetId: string | null; assetName: string; total: number; count: number }
  >();
  for (const d of received) {
    const key = d.asset_id ?? `name:${d.asset_name}`;
    const cur = byAssetMap.get(key) ?? {
      assetId: d.asset_id,
      assetName: d.asset_name,
      total: 0,
      count: 0,
    };
    cur.total += netOf(d);
    cur.count += 1;
    byAssetMap.set(key, cur);
  }

  const monthMap = new Map<string, number>();
  for (const d of received) {
    const k = dateOf(d).slice(0, 7);
    monthMap.set(k, (monthMap.get(k) ?? 0) + netOf(d));
  }

  return {
    period: received.filter((d) => inRange(dateOf(d), range)).reduce((s, d) => s + netOf(d), 0),
    year: received.filter((d) => dateOf(d).slice(0, 4) === year).reduce((s, d) => s + netOf(d), 0),
    total: received.reduce((s, d) => s + netOf(d), 0),
    scheduled: dividends.filter((d) => !isReceived(d, today)).reduce((s, d) => s + netOf(d), 0),
    byAsset: [...byAssetMap.values()].sort((a, b) => b.total - a.total),
    byMonth: [...monthMap.entries()]
      .map(([key, amount]) => ({ key, amount }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Mais/menos-valias realizadas dentro de um período (ledger de vendas). */
export function realizedInRange(transactions: TransactionLike[], range: DateRange): number {
  return transactions
    .filter((t) => t.type === "sell" && inRange(t.traded_at, range))
    .reduce((s, t) => s + (Number(t.realized_pl ?? 0) || 0), 0);
}
