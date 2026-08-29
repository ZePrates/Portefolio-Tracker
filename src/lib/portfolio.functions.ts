import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const assetClassSchema = z.enum([
  "etf",
  "reit",
  "acao_dividendo",
  "acao_crescimento",
  "metal",
  "p2p",
]);

const assetInputSchema = z.object({
  class: assetClassSchema,
  name: z.string().min(1, "Nome é obrigatório"),
  ticker: z.string().nullable().default(null),
  quantity: z.number().min(0).default(0),
  average_price: z.number().min(0).default(0),
  current_price: z.number().min(0).default(0),
  invested_amount: z.number().min(0).default(0),
  current_value: z.number().min(0).default(0),
  currency: z.string().default("EUR"),
  metal_type: z.string().nullable().default(null),
  p2p_group: z.string().nullable().default(null),
  annual_yield: z.number().min(0).nullable().default(null),
  notes: z.string().nullable().default(null),
});

export const listAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assets")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data;
  });

export const createAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => assetInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("assets")
      .insert({ ...data, user_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), patch: assetInputSchema.partial() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("assets")
      .update(data.patch)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("assets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDividends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("dividends")
      .select("*")
      .order("paid_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const createDividend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        asset_id: z.string().uuid().nullable().default(null),
        asset_name: z.string().min(1),
        amount: z.number().positive("Valor tem de ser positivo"),
        paid_at: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("dividends")
      .insert({ ...data, user_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteDividend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("dividends").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("transactions")
      .select("*")
      .order("traded_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });
