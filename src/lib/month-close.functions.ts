import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { monthClose, shiftMonth } from "@/lib/month-close";

/** Estado dos passos do fecho de um mês ("YYYY-MM"). */
export const getMonthClose = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const from = `${data.month}-01`;
    const to = `${shiftMonth(data.month, 1)}-01`;
    const [assetsRes, txRes, divPayRes, divPaidRes, p2pRes] = await Promise.all([
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
    ]);
    for (const r of [assetsRes, txRes, divPayRes, divPaidRes, p2pRes]) {
      if (r.error) throw dbError(r.error);
    }
    return monthClose({
      month: data.month,
      today: todayLisbon(),
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
  });
