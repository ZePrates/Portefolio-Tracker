import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";

/**
 * Despesas associadas a um ativo (ex.: armazenamento de metais).
 * NUNCA alteram a quantidade detida nem geram transações de venda.
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
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
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("asset_expenses").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
