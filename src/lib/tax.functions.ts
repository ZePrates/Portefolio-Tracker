import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { annualTaxReport, type InterestRecord } from "@/lib/tax-report";
import { isScrambleBonus, type ScrambleCashType } from "@/lib/scramble";

/** Movimentos P2P com relevância fiscal: juros e bónus. */
const P2P_INCOME_TYPES = ["interest", "interest_increased", "bonus_noncash", "bonus_cash"];

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
    const [assetsRes, txRes, divRes, profRes, p2pRes] = await Promise.all([
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
      sb
        .from("p2p_cash_movements")
        .select("asset_id, occurred_on, type, amount")
        .in("type", P2P_INCOME_TYPES)
        .gte("occurred_on", `${data.year}-01-01`)
        .lte("occurred_on", `${data.year}-12-31`),
    ]);
    for (const r of [assetsRes, txRes, divRes, profRes, p2pRes])
      if (r.error) throw dbError(r.error);
    const domicile = new Map(
      (profRes.data ?? []).map((p) => [p.asset_id, p.domicile_country] as const),
    );
    const assetName = new Map((assetsRes.data ?? []).map((a) => [a.id, a.name] as const));
    // A Scramble (única plataforma P2P suportada) é uma sociedade estónia.
    const interest: InterestRecord[] = (p2pRes.data ?? []).map((m) => ({
      assetId: m.asset_id,
      assetName: assetName.get(m.asset_id) ?? "P2P",
      date: m.occurred_on,
      amount: Number(m.amount),
      country: "EE",
      kind: isScrambleBonus(m.type as ScrambleCashType) ? "bonus" : "interest",
    }));

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
      interest,
      today: todayLisbon(),
      marginalRate: data.marginalRate,
    });
  });
