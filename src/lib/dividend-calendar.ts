/**
 * Calendário e projeção de dividendos para os próximos meses — lógica pura.
 * Baseia-se na cadência real de cada ativo (ex-dates do histórico), no
 * último dividendo por ação, na quantidade atual e na retenção na fonte.
 * São PROJEÇÕES (sinalizadas): o valor real só se conhece no pagamento.
 */

import { addDaysISO } from "@/lib/dates";
import { currentRateOf } from "@/lib/fx";
import { estimatePaymentDate, withholdingRateFor, type TaxableAsset } from "@/lib/tax";
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

export function projectDividendCalendar(input: {
  assets: CalendarAsset[];
  history: CalendarDividendHistory[];
  today: string;
  months?: number;
}): DividendCalendar {
  const { assets, history, today } = input;
  const horizon = addDaysISO(today, Math.round((input.months ?? 12) * 30.44));
  const events: ProjectedDividend[] = [];
  const skipped: DividendCalendar["skipped"] = [];

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
          ? (currentRateOf(a) ?? Number(last.fx_rate) ?? 1)
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
        paymentDate: estimatePaymentDate(exDate),
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
