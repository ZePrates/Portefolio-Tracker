import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { alertKey, dataQualityAlerts } from "@/lib/data-quality";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { readExposurePages } from "@/lib/exposure-pagination";
import { closeReminderMonth, monthCloseAlert } from "@/lib/month-close";
import { loadMonthClose } from "@/lib/month-close.server";

/** Alertas de qualidade de dados da carteira (só leitura). */
export const getDataQualityAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [assetsRes, txRes, divRes, holdRes, profRes, dismissedRes, p2pRes] = await Promise.all([
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
      // Milhares de linhas: lidas por páginas (a API corta em 1000).
      readExposurePages((from, to) =>
        sb.from("etf_holdings").select("asset_id, weight").order("id").range(from, to),
      ),
      sb.from("asset_profiles").select("asset_id, domicile_country"),
      sb.from("dismissed_alerts").select("alert_key"),
      sb
        .from("p2p_cash_movements")
        .select("asset_id, occurred_on")
        .order("occurred_on", { ascending: false })
        .limit(1000),
    ]);
    for (const r of [assetsRes, txRes, divRes, profRes, dismissedRes, p2pRes])
      if (r.error) throw dbError(r.error);

    const coverage = new Map<string, number>();
    for (const h of holdRes) {
      coverage.set(h.asset_id, (coverage.get(h.asset_id) ?? 0) + (Number(h.weight) || 0));
    }
    const domicile = new Map(
      (profRes.data ?? [])
        .filter((p) => p.domicile_country)
        .map((p) => [p.asset_id, p.domicile_country]),
    );

    const p2pLastMovement = new Map<string, string>();
    for (const m of p2pRes.data ?? []) {
      if (!p2pLastMovement.has(m.asset_id)) p2pLastMovement.set(m.asset_id, m.occurred_on);
    }

    const dismissed = new Set((dismissedRes.data ?? []).map((d) => d.alert_key));
    const today = todayLisbon();
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
      p2pLastMovement,
      today,
    });

    // Lembrete do fecho do mês: só nos últimos dias do mês e até ao dia 10 do seguinte.
    const closeMonth = closeReminderMonth(today);
    if (closeMonth) {
      const reminder = monthCloseAlert(await loadMonthClose(sb, closeMonth, today));
      if (reminder) alerts.unshift(reminder);
    }
    return {
      alerts: alerts.filter((a) => !dismissed.has(alertKey(a))),
      checkedAt: new Date().toISOString(),
    };
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
