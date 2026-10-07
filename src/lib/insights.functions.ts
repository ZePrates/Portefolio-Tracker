import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { todayLisbon } from "@/lib/dates";
import { projectDividendCalendar } from "@/lib/dividend-calendar";
import { dbError } from "@/lib/errors";
import { etfOverlap } from "@/lib/overlap";

/** Calendário/projeção de dividendos dos próximos meses (estimativa). */
export const getDividendCalendar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ months: z.number().int().min(1).max(36).default(12) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const [assetsRes, divRes, profRes] = await Promise.all([
      sb
        .from("assets")
        .select(
          "id, name, class, status, quantity, isin, ticker, withholding_rate, native_currency, fx_rate, current_price, current_price_native",
        ),
      sb
        .from("dividends")
        .select("asset_id, ex_date, per_share_native, currency, fx_rate")
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
      months: data.months,
    });
  });

/** Sobreposição entre os ETFs abertos (holdings conhecidas). */
export const getEtfOverlap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [assetsRes, holdRes] = await Promise.all([
      sb.from("assets").select("id, name").eq("class", "etf").neq("status", "closed"),
      sb.from("etf_holdings").select("asset_id, holding_name, holding_symbol, isin, weight"),
    ]);
    for (const r of [assetsRes, holdRes]) if (r.error) throw dbError(r.error);
    const byAsset = new Map<
      string,
      Array<{ name: string; isin: string | null; symbol: string | null; weight: number }>
    >();
    for (const h of holdRes.data ?? []) {
      const list = byAsset.get(h.asset_id) ?? [];
      list.push({
        name: h.holding_name,
        isin: h.isin,
        symbol: h.holding_symbol,
        weight: Number(h.weight),
      });
      byAsset.set(h.asset_id, list);
    }
    return {
      pairs: etfOverlap(
        (assetsRes.data ?? []).map((a) => ({
          assetId: a.id,
          name: a.name,
          holdings: byAsset.get(a.id) ?? [],
        })),
      ),
    };
  });
