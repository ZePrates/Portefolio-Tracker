import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { dbError } from "@/lib/errors";
import { cleanSymbol } from "@/lib/valuation/symbol";
import type { WatchlistEntry } from "@/lib/watchlist";

/** Símbolo do Yahoo, normalizado para maiúsculas (a tabela só aceita maiúsculas). */
const symbolSchema = z
  .string()
  .max(40)
  .transform((s, ctx) => {
    const clean = cleanSymbol(s);
    if (!clean) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Símbolo inválido." });
      return z.NEVER;
    }
    return clean;
  });

const targetSchema = z.number().finite().positive().max(1e9).nullable();

type Row = {
  id: string;
  symbol: string;
  name: string;
  target_price: number | string | null;
  notes: string | null;
  created_at: string;
};

const toEntry = (r: Row): WatchlistEntry => ({
  id: r.id,
  symbol: r.symbol,
  name: r.name,
  targetPrice: r.target_price == null ? null : Number(r.target_price),
  notes: r.notes,
  createdAt: r.created_at,
});

/** Ações e REITs na watchlist deste utilizador, pela ordem em que foram adicionados. */
export const listWatchlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WatchlistEntry[]> => {
    const { data, error } = await context.supabase
      .from("watchlist")
      .select("id, symbol, name, target_price, notes, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw dbError(error);
    return ((data ?? []) as Row[]).map(toEntry);
  });

/** Adiciona à watchlist; se o símbolo já lá estiver, fica como está. */
export const addToWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        symbol: symbolSchema,
        name: z.string().trim().min(1).max(200),
        targetPrice: targetSchema.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("watchlist").upsert(
      [
        {
          user_id: context.userId,
          symbol: data.symbol,
          name: data.name,
          target_price: data.targetPrice ?? null,
        },
      ],
      { onConflict: "user_id,symbol", ignoreDuplicates: true },
    );
    if (error) throw dbError(error);
    return { ok: true };
  });

/** Retira um símbolo da watchlist. */
export const removeFromWatchlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ symbol: symbolSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("watchlist")
      .delete()
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol);
    if (error) throw dbError(error);
    return { ok: true };
  });

/** Define (ou limpa, com null) o preço-alvo, na moeda da cotação. */
export const setWatchlistTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ symbol: symbolSchema, targetPrice: targetSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("watchlist")
      .update({ target_price: data.targetPrice })
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol)
      .select("id");
    if (error) throw dbError(error);
    if (!rows?.length) throw new Error("Este símbolo já não está na watchlist.");
    return { ok: true };
  });
