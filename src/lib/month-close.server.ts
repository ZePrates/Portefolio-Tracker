import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "@/lib/errors";
import {
  CONFIRMABLE_STEPS,
  confirmKey,
  monthClose,
  shiftMonth,
  type MonthCloseKey,
} from "@/lib/month-close";

/** Lê os dados do mês ("YYYY-MM") e calcula o estado dos passos do fecho. */
export async function loadMonthClose(sb: SupabaseClient<Database>, month: string, today: string) {
  const from = `${month}-01`;
  const to = `${shiftMonth(month, 1)}-01`;
  const [assetsRes, txRes, divPayRes, divPaidRes, p2pRes, confirmedRes] = await Promise.all([
    sb.from("assets").select("id, name, ticker, class"),
    sb
      .from("transactions")
      .select("asset_id, type, traded_at, source, fee")
      .gte("traded_at", from)
      .lt("traded_at", to),
    sb
      .from("dividends")
      .select(
        "asset_id, asset_name, payment_date, paid_at, source, payment_date_estimated, net_amount, amount",
      )
      .gte("payment_date", from)
      .lt("payment_date", to),
    // Dividendos antigos sem data de pagamento: conta a data de recebimento.
    sb
      .from("dividends")
      .select(
        "asset_id, asset_name, payment_date, paid_at, source, payment_date_estimated, net_amount, amount",
      )
      .is("payment_date", null)
      .gte("paid_at", from)
      .lt("paid_at", to),
    sb
      .from("p2p_cash_movements")
      .select("occurred_on, type")
      .gte("occurred_on", from)
      .lt("occurred_on", to),
    sb
      .from("dismissed_alerts")
      .select("alert_key")
      .in(
        "alert_key",
        CONFIRMABLE_STEPS.map((step) => confirmKey(month, step)),
      ),
  ]);
  for (const r of [assetsRes, txRes, divPayRes, divPaidRes, p2pRes, confirmedRes]) {
    if (r.error) throw dbError(r.error);
  }
  const confirmedKeys = new Set((confirmedRes.data ?? []).map((r) => r.alert_key));
  return monthClose({
    month,
    today,
    confirmed: CONFIRMABLE_STEPS.filter((step) =>
      confirmedKeys.has(confirmKey(month, step)),
    ) as MonthCloseKey[],
    assets: assetsRes.data ?? [],
    transactions: (txRes.data ?? []).flatMap((t) =>
      t.asset_id ? [{ ...t, asset_id: t.asset_id, fee: Number(t.fee ?? 0) }] : [],
    ),
    dividends: [...(divPayRes.data ?? []), ...(divPaidRes.data ?? [])].map((d) => ({
      ...d,
      net_amount: d.net_amount == null ? null : Number(d.net_amount),
      amount: d.amount == null ? null : Number(d.amount),
    })),
    p2pMovements: p2pRes.data ?? [],
  });
}
