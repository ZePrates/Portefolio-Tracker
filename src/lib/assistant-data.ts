/**
 * Assistente — agregações puras (sem I/O, sem LLM).
 *
 * Tudo o que o assistente diz com números vem destas funções (ou do código que
 * já alimenta a interface). O modelo só escolhe a ferramenta e explica o resultado.
 */
import { isReceived, grossOf, netOf, taxOf, type DividendRecord } from "@/lib/dividends";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function round(n: number | null | undefined, decimals = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Normaliza texto para pesquisa por nome (sem acentos, minúsculas). */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export interface AssistantDividendRow extends DividendRecord {
  tax_amount?: number | null;
  payment_date_estimated?: boolean | null;
}

export interface DividendReport {
  year: number | null;
  asset: string | null;
  received: { net: number; gross: number; tax: number; count: number };
  scheduled: { net: number; count: number };
  /** Eventos recebidos cuja data de pagamento é uma estimativa (ainda não confirmada pelo extrato). */
  receivedWithEstimatedDate: number;
  byAsset: Array<{ asset: string; net: number; gross: number; count: number }>;
  byMonth: Array<{ month: string; net: number }>;
}

/** Dividendos recebidos/por receber, opcionalmente filtrados por ano e por nome de ativo. */
export function dividendReport(
  rows: AssistantDividendRow[],
  opts: { year?: number | null; asset?: string | null; today: string },
): DividendReport {
  const assetFilter = opts.asset ? norm(opts.asset) : null;
  const dateOf = (d: AssistantDividendRow) => (d.payment_date ?? d.paid_at ?? "").slice(0, 10);
  const selected = rows.filter((d) => {
    if (assetFilter && !norm(d.asset_name).includes(assetFilter)) return false;
    if (opts.year != null && dateOf(d).slice(0, 4) !== String(opts.year)) return false;
    return true;
  });
  const received = selected.filter((d) => isReceived(d, opts.today));
  const scheduled = selected.filter((d) => !isReceived(d, opts.today));

  const byAsset = new Map<string, { net: number; gross: number; count: number }>();
  const byMonth = new Map<string, number>();
  for (const d of received) {
    const a = byAsset.get(d.asset_name) ?? { net: 0, gross: 0, count: 0 };
    a.net += netOf(d);
    a.gross += grossOf(d);
    a.count += 1;
    byAsset.set(d.asset_name, a);
    const m = dateOf(d).slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + netOf(d));
  }

  return {
    year: opts.year ?? null,
    asset: opts.asset ?? null,
    received: {
      net: round2(received.reduce((s, d) => s + netOf(d), 0)),
      gross: round2(received.reduce((s, d) => s + grossOf(d), 0)),
      tax: round2(received.reduce((s, d) => s + taxOf(d), 0)),
      count: received.length,
    },
    scheduled: {
      net: round2(scheduled.reduce((s, d) => s + netOf(d), 0)),
      count: scheduled.length,
    },
    receivedWithEstimatedDate: received.filter((d) => d.payment_date_estimated === true).length,
    byAsset: [...byAsset.entries()]
      .map(([asset, v]) => ({
        asset,
        net: round2(v.net),
        gross: round2(v.gross),
        count: v.count,
      }))
      .sort((a, b) => b.net - a.net)
      .slice(0, 25),
    byMonth: [...byMonth.entries()]
      .map(([month, net]) => ({ month, net: round2(net) }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export interface SellRow {
  type: string;
  traded_at: string;
  realized_pl?: number | null;
  asset_id: string | null;
}

export interface RealizedReport {
  year: number | null;
  total: number;
  sales: number;
  byYear: Array<{ year: string; realized: number; sales: number }>;
  byAsset: Array<{ asset: string; realized: number; sales: number }>;
  note: string;
}

/** Mais/menos-valias realizadas (FIFO da app), por ano e por ativo. */
export function realizedReport(
  txs: SellRow[],
  names: Map<string, string>,
  year?: number | null,
): RealizedReport {
  const sells = txs.filter((t) => t.type === "sell");
  const inYear =
    year == null ? sells : sells.filter((t) => t.traded_at.slice(0, 4) === String(year));
  const byYear = new Map<string, { realized: number; sales: number }>();
  for (const t of sells) {
    const y = t.traded_at.slice(0, 4);
    const cur = byYear.get(y) ?? { realized: 0, sales: 0 };
    cur.realized += Number(t.realized_pl ?? 0) || 0;
    cur.sales += 1;
    byYear.set(y, cur);
  }
  const byAsset = new Map<string, { realized: number; sales: number }>();
  for (const t of inYear) {
    const name = (t.asset_id && names.get(t.asset_id)) || "Ativo removido";
    const cur = byAsset.get(name) ?? { realized: 0, sales: 0 };
    cur.realized += Number(t.realized_pl ?? 0) || 0;
    cur.sales += 1;
    byAsset.set(name, cur);
  }
  return {
    year: year ?? null,
    total: round2(inYear.reduce((s, t) => s + (Number(t.realized_pl ?? 0) || 0), 0)),
    sales: inYear.length,
    byYear: [...byYear.entries()]
      .map(([y, v]) => ({ year: y, realized: round2(v.realized), sales: v.sales }))
      .sort((a, b) => a.year.localeCompare(b.year)),
    byAsset: [...byAsset.entries()]
      .map(([asset, v]) => ({ asset, realized: round2(v.realized), sales: v.sales }))
      .sort((a, b) => Math.abs(b.realized) - Math.abs(a.realized))
      .slice(0, 25),
    note: "Resultado FIFO calculado pela app (não é o apuramento de IRS: ver a página IRS).",
  };
}

export interface SnapshotRow {
  snapshot_date: string;
  market_value: number | null;
  invested_amount: number;
}

export interface SnapshotReport {
  scope: string;
  points: number;
  first: { date: string; marketValue: number | null; invested: number } | null;
  last: { date: string; marketValue: number | null; invested: number } | null;
  /** Variação do valor de mercado entre o primeiro e o último ponto. */
  marketValueChange: number | null;
  marketValueChangePct: number | null;
  /** No máximo `maxPoints` pontos, repartidos uniformemente, incluindo o primeiro e o último. */
  series: Array<{ date: string; marketValue: number | null; invested: number }>;
}

export function snapshotReport(rows: SnapshotRow[], scope: string, maxPoints = 30): SnapshotReport {
  const sorted = [...rows].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const toPoint = (r: SnapshotRow) => ({
    date: r.snapshot_date,
    marketValue: round(r.market_value),
    invested: round2(Number(r.invested_amount) || 0),
  });
  let picked = sorted;
  if (sorted.length > maxPoints) {
    picked = [];
    for (let i = 0; i < maxPoints; i++) {
      picked.push(sorted[Math.round((i * (sorted.length - 1)) / (maxPoints - 1))]!);
    }
  }
  const first = sorted[0] ? toPoint(sorted[0]) : null;
  const last = sorted.length ? toPoint(sorted[sorted.length - 1]!) : null;
  const change =
    first?.marketValue != null && last?.marketValue != null
      ? round2(last.marketValue - first.marketValue)
      : null;
  return {
    scope,
    points: sorted.length,
    first,
    last,
    marketValueChange: change,
    marketValueChangePct:
      change != null && first?.marketValue ? round2((change / first.marketValue) * 100) : null,
    series: picked.map(toPoint),
  };
}

/** Arredonda recursivamente todos os números (2 casas) para poupar tokens e evitar ruído de vírgula flutuante. */
export function roundDeep<T>(value: T, decimals = 2): T {
  if (typeof value === "number") return (round(value, decimals) ?? 0) as T;
  if (Array.isArray(value)) return value.map((v) => roundDeep(v, decimals)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, roundDeep(v, decimals)]),
    ) as T;
  }
  return value;
}
