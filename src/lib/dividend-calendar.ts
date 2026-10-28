/**
 * Calendário e projeção de dividendos para os próximos meses — lógica pura.
 * Baseia-se na cadência real de cada ativo (ex-dates do histórico), no
 * último dividendo por ação, na quantidade atual e na retenção na fonte.
 * A data de pagamento usa o desfasamento mediano dos pagamentos confirmados
 * de cada ativo (14 dias se ainda não houver amostras).
 * São PROJEÇÕES (sinalizadas): o valor real só se conhece no pagamento.
 */

import { addDaysISO } from "@/lib/dates";
import { currentRateOf } from "@/lib/fx";
import {
  estimatePaymentDate,
  paymentLagByAsset,
  withholdingRateFor,
  type TaxableAsset,
} from "@/lib/tax";
import { inferPaymentsPerYear } from "@/lib/yield";

export interface CalendarAsset extends TaxableAsset {
  id: string;
  name: string;
  status: string;
  quantity: number;
  native_currency?: string | null;
  fx_rate?: number | null;
  current_price?: number | null;
  current_price_native?: number | null;
}

export interface CalendarDividendHistory {
  asset_id: string | null;
  ex_date: string | null;
  per_share_native?: number | null;
  currency?: string | null;
  fx_rate?: number | null;
  /** Com `payment_date_estimated`, permitem medir o desfasamento real de cada ativo. */
  payment_date?: string | null;
  payment_date_estimated?: boolean | null;
}

export interface ProjectedDividend {
  assetId: string;
  assetName: string;
  exDate: string;
  paymentDate: string;
  perShareNative: number;
  currency: string;
  quantity: number;
  gross: number;
  tax: number;
  net: number;
}

export interface DividendCalendar {
  events: ProjectedDividend[];
  byMonth: Array<{ month: string; gross: number; net: number }>;
  totalGross: number;
  totalNet: number;
  /** Ativos com histórico insuficiente para projetar. */
  skipped: Array<{ assetId: string; assetName: string; reason: string }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Última ex-date projetada para um horizonte de `months` meses. */
function horizonEnd(today: string, months = 12): string {
  return addDaysISO(today, Math.round(months * 30.44));
}

export function projectDividendCalendar(input: {
  assets: CalendarAsset[];
  history: CalendarDividendHistory[];
  today: string;
  months?: number;
}): DividendCalendar {
  const { assets, history, today } = input;
  const horizon = horizonEnd(today, input.months);
  const events: ProjectedDividend[] = [];
  const skipped: DividendCalendar["skipped"] = [];
  const lagByAsset = paymentLagByAsset(history);

  for (const a of assets) {
    const qty = Number(a.quantity) || 0;
    if (a.status === "closed" || qty <= 0) continue;
    const rows = history
      .filter((h) => h.asset_id === a.id && h.ex_date && Number(h.per_share_native) > 0)
      .sort((x, y) => x.ex_date!.localeCompare(y.ex_date!));
    if (rows.length === 0) continue;

    const perYear = inferPaymentsPerYear(
      rows.map((r) => ({ date: r.ex_date!, amount: Number(r.per_share_native) })),
    );
    if (!perYear) {
      skipped.push({
        assetId: a.id,
        assetName: a.name,
        reason: "Cadência de pagamentos irregular.",
      });
      continue;
    }
    const last = rows[rows.length - 1]!;
    const intervalDays = Math.round(365.25 / perYear);
    // Sem pagamentos há mais de 2 ciclos: provavelmente suspendeu o dividendo.
    if (last.ex_date! < addDaysISO(today, -2 * intervalDays)) {
      skipped.push({ assetId: a.id, assetName: a.name, reason: "Sem dividendos recentes." });
      continue;
    }

    const currency = (last.currency ?? a.native_currency ?? "EUR").toUpperCase();
    const fx =
      currency === "EUR"
        ? 1
        : currency === (a.native_currency ?? "EUR").toUpperCase()
          ? (currentRateOf(a) ?? (Number(last.fx_rate) || 1))
          : Number(last.fx_rate) || 1;
    const perShare = Number(last.per_share_native);
    const wht = withholdingRateFor(a).rate;

    for (let k = 1; k <= perYear * 3; k++) {
      const exDate = addDaysISO(last.ex_date!, k * intervalDays);
      if (exDate <= today) continue;
      if (exDate > horizon) break;
      const gross = qty * perShare * fx;
      const tax = gross * wht;
      events.push({
        assetId: a.id,
        assetName: a.name,
        exDate,
        paymentDate: estimatePaymentDate(exDate, lagByAsset.get(a.id)),
        perShareNative: perShare,
        currency,
        quantity: qty,
        gross: round2(gross),
        tax: round2(tax),
        net: round2(gross - tax),
      });
    }
  }

  events.sort(
    (x, y) => x.paymentDate.localeCompare(y.paymentDate) || x.assetName.localeCompare(y.assetName),
  );
  const monthMap = new Map<string, { gross: number; net: number }>();
  for (const e of events) {
    const m = e.paymentDate.slice(0, 7);
    const cur = monthMap.get(m) ?? { gross: 0, net: 0 };
    cur.gross += e.gross;
    cur.net += e.net;
    monthMap.set(m, cur);
  }
  return {
    events,
    byMonth: [...monthMap.entries()]
      .map(([month, v]) => ({ month, gross: round2(v.gross), net: round2(v.net) }))
      .sort((x, y) => x.month.localeCompare(y.month)),
    totalGross: round2(events.reduce((s, e) => s + e.gross, 0)),
    totalNet: round2(events.reduce((s, e) => s + e.net, 0)),
    skipped,
  };
}

/* ------------------------------------------------------------------ */
/* Vista de calendário                                                 */
/* ------------------------------------------------------------------ */

/** "2026-11" → "2026-12" (n meses à frente). */
function addMonthsKey(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Semanas de um mês ("YYYY-MM"), de segunda a domingo, com datas ISO;
 * `null` nas casas que pertencem ao mês anterior ou seguinte.
 */
export function buildMonthGrid(monthKey: string): Array<Array<string | null>> {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells; i++) {
    const d = i - lead + 1;
    if (i % 7 === 0) weeks.push([]);
    weeks.at(-1)!.push(d >= 1 && d <= days ? `${monthKey}-${String(d).padStart(2, "0")}` : null);
  }
  return weeks;
}

export interface CalendarMonth {
  month: string;
  count: number;
  net: number;
  gross: number;
  /** Ativos que pagam no mês, sem repetidos, pela ordem de pagamento. */
  assets: string[];
  byDay: Record<string, ProjectedDividend[]>;
}

/**
 * Pagamentos agrupados por mês, do mês atual até ao fim do horizonte (ou ao
 * último pagamento estimado, que pode cair depois da última ex-date).
 */
export function calendarMonths(input: {
  events: ProjectedDividend[];
  today: string;
  months?: number;
}): CalendarMonth[] {
  const sorted = [...input.events].sort(
    (x, y) => x.paymentDate.localeCompare(y.paymentDate) || x.assetName.localeCompare(y.assetName),
  );
  const first = input.today.slice(0, 7);
  const lastPayment = sorted.at(-1)?.paymentDate.slice(0, 7) ?? first;
  const horizonMonth = horizonEnd(input.today, input.months).slice(0, 7);
  const last = lastPayment > horizonMonth ? lastPayment : horizonMonth;

  const out: CalendarMonth[] = [];
  for (let key = first; key <= last; key = addMonthsKey(key, 1)) {
    const evs = sorted.filter((e) => e.paymentDate.startsWith(key));
    const byDay: CalendarMonth["byDay"] = {};
    for (const e of evs) (byDay[e.paymentDate] ??= []).push(e);
    out.push({
      month: key,
      count: evs.length,
      net: round2(evs.reduce((s, e) => s + e.net, 0)),
      gross: round2(evs.reduce((s, e) => s + e.gross, 0)),
      assets: [...new Set(evs.map((e) => e.assetName))],
      byDay,
    });
  }
  return out;
}

const LEGAL_SUFFIX =
  /,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|PLC|plc|Ltd\.?|Limited|S\.?A\.?|N\.?V\.?|AG|SE)$/;

/** Nome curto para etiquetas: "Realty Income Corporation" → "Realty Income". */
export function shortCompanyName(name: string): string {
  const short = name.trim().replace(LEGAL_SUFFIX, "").trim();
  return short || name;
}
