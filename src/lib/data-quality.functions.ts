import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { alertKey, dataQualityAlerts } from "@/lib/data-quality";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";

/** Alertas de qualidade de dados da carteira (só leitura). */
export const getDataQualityAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [assetsRes, txRes, divRes, holdRes, profRes, dismissedRes] = await Promise.all([
      sb
        .from("assets")
        .select(
          "id, name, class, status, quantity, current_price, price_updated_at, ticker, isin, withholding_rate",
        ),
      sb
        .from("transactions")
        .select(
          "id, asset_id, type, quantity, price, fee, traded_at, created_at, native_currency, fx_source",
        ),
      sb
        .from("dividends")
        .select("asset_id, amount, gross_amount, tax_amount, status, payment_date_estimated"),
      sb.from("etf_holdings").select("asset_id, weight"),
      sb.from("asset_profiles").select("asset_id, domicile_country"),
      sb.from("dismissed_alerts").select("alert_key"),
    ]);
    for (const r of [assetsRes, txRes, divRes, holdRes, profRes, dismissedRes])
      if (r.error) throw dbError(r.error);

    const coverage = new Map<string, number>();
    for (const h of holdRes.data ?? []) {
      coverage.set(h.asset_id, (coverage.get(h.asset_id) ?? 0) + (Number(h.weight) || 0));
    }
    const domicile = new Map(
      (profRes.data ?? [])
        .filter((p) => p.domicile_country)
        .map((p) => [p.asset_id, p.domicile_country]),
    );

    const dismissed = new Set((dismissedRes.data ?? []).map((d) => d.alert_key));
    const alerts = dataQualityAlerts({
      assets: (assetsRes.data ?? []).map((a) => ({
        ...a,
        quantity: Number(a.quantity),
        current_price: Number(a.current_price),
        domicile: domicile.get(a.id) ?? null,
      })),
      transactions: (txRes.data ?? []).map((t) => ({
        ...t,
        quantity: Number(t.quantity),
        price: Number(t.price),
        fee: Number(t.fee ?? 0),
      })),
      dividends: divRes.data ?? [],
      holdingsCoverage: coverage,
      today: todayLisbon(),
    }).filter((a) => !dismissed.has(alertKey(a)));
    return { alerts, checkedAt: new Date().toISOString() };
  });

/** Dispensa avisos (por chave); ficam guardados na conta, em todos os dispositivos. */
export const dismissDataQualityAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ keys: z.array(z.string().min(1).max(500)).min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("dismissed_alerts").upsert(
      data.keys.map((alert_key) => ({ user_id: context.userId, alert_key })),
      { onConflict: "user_id,alert_key" },
    );
    if (error) throw dbError(error);
    return { ok: true };
  });
