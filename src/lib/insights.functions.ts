import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { todayLisbon } from "@/lib/dates";
import { projectDividendCalendar } from "@/lib/dividend-calendar";
import { dbError } from "@/lib/errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/external-types";

/** Calendário/projeção de dividendos dos próximos meses (estimativa); partilhado com o assistente. */
export async function loadDividendCalendar(sb: SupabaseClient<Database>, months: number) {
  const [assetsRes, divRes, profRes] = await Promise.all([
    sb
      .from("assets")
      .select(
        "id, name, class, status, quantity, isin, ticker, withholding_rate, native_currency, fx_rate, current_price, current_price_native",
      ),
    sb
      .from("dividends")
      .select(
        "asset_id, ex_date, per_share_native, currency, fx_rate, payment_date, payment_date_estimated",
      )
      .not("ex_date", "is", null),
    sb.from("asset_profiles").select("asset_id, domicile_country"),
  ]);
  for (const r of [assetsRes, divRes, profRes]) if (r.error) throw dbError(r.error);
  const domicile = new Map(
    (profRes.data ?? []).map((p) => [p.asset_id, p.domicile_country] as const),
  );
  return projectDividendCalendar({
    assets: (assetsRes.data ?? []).map((a) => ({
      ...a,
      quantity: Number(a.quantity),
      domicile: domicile.get(a.id) ?? null,
    })),
    history: divRes.data ?? [],
    today: todayLisbon(),
    months,
  });
}

/** Calendário/projeção de dividendos dos próximos meses (estimativa). */
export const getDividendCalendar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ months: z.number().int().min(1).max(36).default(12) }).parse(input ?? {}),
  )
  .handler(({ data, context }) => loadDividendCalendar(context.supabase, data.months));
