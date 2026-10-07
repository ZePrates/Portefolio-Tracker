import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { annualTaxReport } from "@/lib/tax-report";

/** Resumo fiscal anual (mais-valias FIFO, dividendos, Anexos G/J/E). Só leitura. */
export const getTaxReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        year: z.number().int().min(2000).max(2100),
        /** Taxa marginal de IRS (0..1) para simular o englobamento. */
        marginalRate: z.number().min(0).lt(1).nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const [assetsRes, txRes, divRes, profRes] = await Promise.all([
      sb.from("assets").select("id, name, class, isin, ticker, withholding_rate"),
      sb
        .from("transactions")
        .select("id, asset_id, type, quantity, price, fee, traded_at, created_at"),
      sb
        .from("dividends")
        .select(
          "asset_id, asset_name, amount, gross_amount, tax_amount, net_amount, paid_at, payment_date, payment_date_estimated, status, currency",
        ),
      sb.from("asset_profiles").select("asset_id, domicile_country"),
    ]);
    for (const r of [assetsRes, txRes, divRes, profRes]) if (r.error) throw dbError(r.error);
    const domicile = new Map(
      (profRes.data ?? []).map((p) => [p.asset_id, p.domicile_country] as const),
    );

    return annualTaxReport({
      year: data.year,
      assets: (assetsRes.data ?? []).map((a) => ({ ...a, domicile: domicile.get(a.id) ?? null })),
      transactions: (txRes.data ?? []).map((t) => ({
        ...t,
        quantity: Number(t.quantity),
        price: Number(t.price),
        fee: Number(t.fee ?? 0),
      })),
      dividends: divRes.data ?? [],
      today: todayLisbon(),
      marginalRate: data.marginalRate,
    });
  });
