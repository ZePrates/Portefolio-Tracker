import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { replayLedger } from "@/lib/fifo";
import { loadPosition, recomputeAsset } from "@/lib/portfolio.functions";
import { dbError } from "@/lib/errors";

/**
 * Despesas associadas a um ativo (ex.: armazenamento de metais).
 * Nunca geram vendas. Pagas em dinheiro: não mexem na quantidade. Pagas em
 * espécie (`grams_deducted` > 0, ex.: Elementum cobra a taxa em gramas):
 * reduzem a quantidade detida e o custo total fica nos gramas restantes.
 */
export const listExpenses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ assetId: z.string().uuid().nullable().default(null) })
      .default({ assetId: null })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("asset_expenses")
      .select("*")
      .order("incurred_at", { ascending: false });
    if (data.assetId) q = q.eq("asset_id", data.assetId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows;
  });

export const createExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        assetId: z.string().uuid(),
        type: z.string().min(1).default("storage"),
        amount: z.number().positive("O valor tem de ser positivo."),
        currency: z.string().length(3).default("EUR"),
        fx_rate: z.number().positive().default(1),
        incurred_at: z.string().min(1),
        notes: z.string().nullable().default(null),
        /** Gramas deduzidos do cofre (taxa paga em espécie); 0 = paga em dinheiro. */
        grams_deducted: z.number().min(0).default(0),
        /** Preço por grama usado pela custódia para converter a taxa. */
        price_per_gram: z.number().positive().nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const inKind = data.grams_deducted > 0;
    if (inKind) {
      // Valida ANTES de gravar: não se pode deduzir mais do que o detido nessa data.
      const { entries } = await loadPosition(context.supabase, data.assetId);
      replayLedger([
        ...entries,
        {
          type: "storage",
          quantity: data.grams_deducted,
          price: data.price_per_gram ?? 0,
          fee: 0,
          traded_at: data.incurred_at,
          created_at: new Date().toISOString(),
        },
      ]);
    }
    const { data: row, error } = await context.supabase
      .from("asset_expenses")
      .insert({
        user_id: context.userId,
        asset_id: data.assetId,
        type: data.type,
        amount: data.amount * data.fx_rate,
        amount_native: data.amount,
        currency: data.currency.toUpperCase(),
        fx_rate: data.fx_rate,
        incurred_at: data.incurred_at,
        notes: data.notes,
        grams_deducted: data.grams_deducted,
        price_per_gram: data.price_per_gram,
      })
      .select()
      .single();
    if (error) throw dbError(error);
    if (inKind) {
      try {
        await recomputeAsset(context.supabase, data.assetId);
      } catch (e) {
        await context.supabase.from("asset_expenses").delete().eq("id", row.id);
        throw e;
      }
    }
    return row;
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: exp, error: findError } = await context.supabase
      .from("asset_expenses")
      .select("id, asset_id, grams_deducted")
      .eq("id", data.id)
      .single();
    if (findError || !exp) throw dbError(findError, "Despesa não encontrada.");
    const { error } = await context.supabase.from("asset_expenses").delete().eq("id", data.id);
    if (error) throw dbError(error);
    if (exp.asset_id && Number(exp.grams_deducted) > 0) {
      await recomputeAsset(context.supabase, exp.asset_id);
    }
    return { ok: true };
  });
