/**
 * Lógica pura de dividendos — determinística e testável isoladamente.
 * Nunca usa a quantidade atual do ativo: a elegibilidade é sempre
 * reconstruída a partir do histórico de compras e vendas (mesmo ledger do FIFO).
 */

export interface DividendTrade {
  type: string; // "buy" | "sell"
  quantity: number;
  /** Data do negócio (YYYY-MM-DD). */
  traded_at: string;
  created_at?: string;
}

export type DividendStatus = "received" | "scheduled" | "unknown";

export interface DividendEventInput {
  /** Data ex-dividendo (YYYY-MM-DD) — determina quem tem direito. */
  exDate: string;
  /** Data de pagamento efetiva, se conhecida. */
  paymentDate?: string | null;
  /** Dividendo por ação na moeda de origem. */
  perShareNative: number;
  /** Moeda de origem (ex.: "USD"). */
  currency: string;
  /** Taxa de conversão para EUR (1 se já em EUR). */
  fxRate: number;
  /** Data da taxa de câmbio utilizada. */
  fxDate?: string | null;
  /** Impostos/retenções em EUR, quando conhecidos. */
  taxAmount?: number;
  /** Comissões em EUR, quando existirem. */
  feeAmount?: number;
}

export interface ComputedDividend {
  exDate: string;
  paymentDate: string | null;
  currency: string;
  perShareNative: number;
  /** Quantidade elegível na data ex-dividendo. */
  eligibleQuantity: number;
  /** Valor bruto na moeda de origem. */
  amountNative: number;
  fxRate: number;
  fxDate: string | null;
  /** Valor bruto em EUR. */
  grossAmount: number;
  taxAmount: number;
  feeAmount: number;
  /** Valor líquido em EUR. */
  netAmount: number;
  status: DividendStatus;
}

const EPS = 1e-9;

function sortTrades(trades: DividendTrade[]): DividendTrade[] {
  return [...trades].sort((a, b) => {
    const d = a.traded_at.localeCompare(b.traded_at);
    if (d !== 0) return d;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

/**
 * Quantidade detida imediatamente antes de `date` (exclusivo).
 * Para ter direito a um dividendo é preciso deter as ações antes da data ex-dividendo:
 * compras feitas na própria data ex-dividendo não são elegíveis;
 * vendas feitas na própria data ex-dividendo (ou depois) não retiram elegibilidade.
 */
export function quantityHeldBefore(trades: DividendTrade[], date: string): number {
  let qty = 0;
  for (const t of sortTrades(trades)) {
    if (!(t.traded_at < date)) continue;
    const q = Number(t.quantity) || 0;
    if (q <= 0) continue;
    if (t.type === "buy") qty += q;
    else if (t.type === "sell") qty -= q;
  }
  return qty < EPS ? 0 : qty;
}

/** Data da primeira compra (aquisição inicial), ou null se não houver compras. */
export function firstPurchaseDate(trades: DividendTrade[]): string | null {
  const buys = sortTrades(trades).filter((t) => t.type === "buy" && Number(t.quantity) > 0);
  return buys.length > 0 ? buys[0]!.traded_at : null;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Classifica um evento: só é "recebido" com data de pagamento efetiva já passada. */
export function classifyDividend(
  paymentDate: string | null | undefined,
  today = todayISO(),
): DividendStatus {
  if (!paymentDate) return "unknown";
  return paymentDate <= today ? "received" : "scheduled";
}

/**
 * Calcula um evento de dividendos para uma posição, usando o histórico real.
 * Devolve null quando o utilizador não tinha posição elegível na data ex-dividendo.
 */
export function computeDividend(
  trades: DividendTrade[],
  input: DividendEventInput,
  today = todayISO(),
): ComputedDividend | null {
  const eligibleQuantity = quantityHeldBefore(trades, input.exDate);
  if (eligibleQuantity <= EPS) return null;
  const perShare = Number(input.perShareNative) || 0;
  if (perShare <= 0) return null;

  const amountNative = eligibleQuantity * perShare;
  const fxRate = Number(input.fxRate) || 1;
  const grossAmount = amountNative * fxRate;
  const taxAmount = Number(input.taxAmount ?? 0) || 0;
  const feeAmount = Number(input.feeAmount ?? 0) || 0;

  return {
    exDate: input.exDate,
    paymentDate: input.paymentDate ?? null,
    currency: input.currency.toUpperCase(),
    perShareNative: perShare,
    eligibleQuantity,
    amountNative,
    fxRate,
    fxDate: input.fxDate ?? null,
    grossAmount,
    taxAmount,
    feeAmount,
    netAmount: grossAmount - taxAmount - feeAmount,
    status: classifyDividend(input.paymentDate, today),
  };
}

/**
 * Calcula todos os eventos de um histórico de dividendos de uma fonte,
 * ignorando os anteriores à aquisição e os sem posição elegível.
 */
export function computeDividendHistory(
  trades: DividendTrade[],
  events: DividendEventInput[],
  today = todayISO(),
): ComputedDividend[] {
  const first = firstPurchaseDate(trades);
  if (!first) return [];
  return events
    .filter((e) => e.exDate > first)
    .map((e) => computeDividend(trades, e, today))
    .filter((d): d is ComputedDividend => d !== null)
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
}

/* ------------------------------------------------------------------ */
/* Identidade determinística e auditoria                               */
/* ------------------------------------------------------------------ */

/**
 * Chave determinística de um evento de dividendos.
 * Usada para deduplicação/idempotência: correr a sincronização N vezes
 * produz sempre a mesma chave e, portanto, o mesmo registo.
 */
export function dividendEventKey(input: {
  source: string;
  symbol: string;
  exDate: string;
  currency?: string | null;
  perShareNative?: number | null;
}): string {
  const cur = (input.currency ?? "EUR").toUpperCase();
  const per = input.perShareNative == null ? "" : `:${Number(input.perShareNative).toFixed(6)}`;
  return `${input.source}:${input.symbol.toUpperCase()}:${input.exDate}:${cur}${per}`;
}

export type DividendIssue =
  | "future_marked_received"
  | "missing_payment_date"
  | "before_first_purchase"
  | "not_eligible_at_ex_date"
  | "eligible_quantity_mismatch"
  | "amount_mismatch"
  | "missing_fx_rate"
  | "wrong_status";

export interface AuditableDividend extends DividendRecord {
  ex_date?: string | null;
  per_share_native?: number | null;
  fx_rate?: number | null;
  eligible_quantity?: number | null;
}

/**
 * Audita um registo face ao ledger real. Puro e determinístico:
 * devolve os problemas encontrados e os valores corretos (quando calculáveis).
 */
export function auditDividendRecord(
  row: AuditableDividend,
  trades: DividendTrade[],
  today = todayISO(),
): { issues: DividendIssue[]; expected: ComputedDividend | null } {
  const issues: DividendIssue[] = [];
  const pay = row.payment_date ?? null;

  if (!pay) issues.push("missing_payment_date");
  if (pay && pay > today && row.status === "received") issues.push("future_marked_received");
  if (pay && classifyDividend(pay, today) !== (row.status ?? "")) issues.push("wrong_status");

  if (!row.ex_date) return { issues, expected: null };

  const first = firstPurchaseDate(trades);
  if (!first || row.ex_date <= first) {
    issues.push("before_first_purchase");
    return { issues, expected: null };
  }

  const currency = (row.currency ?? "EUR").toUpperCase();
  const fxRate = Number(row.fx_rate ?? (currency === "EUR" ? 1 : 0)) || 0;
  if (!(fxRate > 0)) issues.push("missing_fx_rate");

  const perShare = Number(row.per_share_native ?? 0) || 0;
  const expected = computeDividend(
    trades,
    {
      exDate: row.ex_date,
      paymentDate: pay,
      perShareNative: perShare,
      currency,
      fxRate: fxRate > 0 ? fxRate : 1,
    },
    today,
  );

  if (!expected) {
    issues.push("not_eligible_at_ex_date");
    return { issues, expected: null };
  }
  if (Math.abs(Number(row.eligible_quantity ?? -1) - expected.eligibleQuantity) > 1e-6) {
    issues.push("eligible_quantity_mismatch");
  }
  if (Math.abs(grossOf(row) - expected.grossAmount) > 1e-6) issues.push("amount_mismatch");

  return { issues, expected };
}

/** Agrupa registos por chave determinística; grupos com >1 item são duplicados. */
export function findDuplicateGroups<T extends AuditableDividend & { id?: string }>(
  rows: T[],
): T[][] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const key = [
      r.asset_id ?? `name:${r.asset_name}`,
      r.ex_date ?? r.payment_date ?? r.paid_at,
      (r.currency ?? "EUR").toUpperCase(),
      (Number(r.per_share_native ?? 0) || 0).toFixed(6),
    ].join("|");
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

/* ------------------------------------------------------------------ */
/* Agregações                                                          */
/* ------------------------------------------------------------------ */

export interface DividendRecord {
  asset_id: string | null;
  asset_name: string;
  amount: number; // EUR bruto (compatibilidade)
  gross_amount?: number | null;
  net_amount?: number | null;
  amount_native?: number | null;
  currency?: string | null;
  payment_date?: string | null;
  paid_at: string;
  status?: string | null;
}

/** Só entram no total recebido eventos com pagamento efetivo já ocorrido. */
export function isReceived(d: DividendRecord, today = todayISO()): boolean {
  if (d.status === "scheduled" || d.status === "unknown") return false;
  const pay = d.payment_date ?? d.paid_at;
  if (!pay) return false;
  return pay <= today;
}

export function grossOf(d: DividendRecord): number {
  return Number(d.gross_amount ?? d.amount ?? 0) || 0;
}

export function netOf(d: DividendRecord): number {
  const net = d.net_amount;
  return net == null ? grossOf(d) : Number(net) || 0;
}

export function totalReceived(rows: DividendRecord[], today = todayISO()): number {
  return rows.filter((d) => isReceived(d, today)).reduce((s, d) => s + grossOf(d), 0);
}

export function totalScheduled(rows: DividendRecord[], today = todayISO()): number {
  return rows.filter((d) => !isReceived(d, today)).reduce((s, d) => s + grossOf(d), 0);
}

export function receivedInYear(rows: DividendRecord[], year: number, today = todayISO()): number {
  return rows
    .filter(
      (d) => isReceived(d, today) && (d.payment_date ?? d.paid_at).slice(0, 4) === String(year),
    )
    .reduce((s, d) => s + grossOf(d), 0);
}

export function receivedByMonth(
  rows: DividendRecord[],
  today = todayISO(),
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of rows) {
    if (!isReceived(d, today)) continue;
    const key = (d.payment_date ?? d.paid_at).slice(0, 7);
    out[key] = (out[key] ?? 0) + grossOf(d);
  }
  return out;
}

export function receivedByYear(rows: DividendRecord[], today = todayISO()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of rows) {
    if (!isReceived(d, today)) continue;
    const key = (d.payment_date ?? d.paid_at).slice(0, 4);
    out[key] = (out[key] ?? 0) + grossOf(d);
  }
  return out;
}

export function receivedByAsset(
  rows: DividendRecord[],
  today = todayISO(),
): Array<{
  assetId: string | null;
  assetName: string;
  total: number;
  count: number;
}> {
  const map = new Map<
    string,
    { assetId: string | null; assetName: string; total: number; count: number }
  >();
  for (const d of rows) {
    if (!isReceived(d, today)) continue;
    const key = d.asset_id ?? `name:${d.asset_name}`;
    const cur = map.get(key) ?? {
      assetId: d.asset_id,
      assetName: d.asset_name,
      total: 0,
      count: 0,
    };
    cur.total += grossOf(d);
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** Totais na moeda original, por moeda. */
export function receivedByCurrency(
  rows: DividendRecord[],
  today = todayISO(),
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of rows) {
    if (!isReceived(d, today)) continue;
    const cur = (d.currency ?? "EUR").toUpperCase();
    out[cur] = (out[cur] ?? 0) + (Number(d.amount_native ?? grossOf(d)) || 0);
  }
  return out;
}

/** Yield sobre o custo: dividendos recebidos nos últimos 12 meses / custo investido. */
export function yieldOnCost(receivedLast12m: number, investedCost: number): number | null {
  if (!(investedCost > 0)) return null;
  return (receivedLast12m / investedCost) * 100;
}

/** Yield atual: dividendos por ação (TTM) / preço atual. */
export function currentYield(perShareTTM: number, currentPrice: number): number | null {
  if (!(currentPrice > 0) || !(perShareTTM > 0)) return null;
  return (perShareTTM / currentPrice) * 100;
}

export function receivedLast12Months(rows: DividendRecord[], today = todayISO()): number {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  const cutoff = d.toISOString().slice(0, 10);
  return rows
    .filter((r) => isReceived(r, today) && (r.payment_date ?? r.paid_at) >= cutoff)
    .reduce((s, r) => s + grossOf(r), 0);
}

export function lastDividend(rows: DividendRecord[], today = todayISO()): DividendRecord | null {
  const received = rows
    .filter((d) => isReceived(d, today))
    .sort((a, b) => (a.payment_date ?? a.paid_at).localeCompare(b.payment_date ?? b.paid_at));
  return received.length > 0 ? received[received.length - 1]! : null;
}

export function nextDividend(rows: DividendRecord[], today = todayISO()): DividendRecord | null {
  const upcoming = rows
    .filter((d) => !isReceived(d, today) && (d.payment_date ?? d.paid_at) > today)
    .sort((a, b) => (a.payment_date ?? a.paid_at).localeCompare(b.payment_date ?? b.paid_at));
  return upcoming[0] ?? null;
}
