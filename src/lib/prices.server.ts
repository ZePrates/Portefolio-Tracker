import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/external-types";
import { runPriceUpdate, type PriceablePosition, type Quote } from "@/lib/prices";

export type PricesDb = SupabaseClient<Database>;

export interface PriceRefreshFilter {
  class: string | null;
  assetId: string | null;
}

/**
 * Atualização central de preços de um utilizador: títulos (Yahoo Finance) e
 * metais (futuros spot Yahoo), com câmbio real para EUR. Um ativo que falhe
 * não interrompe os restantes e o último preço válido nunca é substituído por
 * 0/null. Filtra sempre por `user_id`, para poder correr também com o cliente
 * de administração (tarefa diária), que não passa pelas regras RLS.
 */
export async function refreshPrices(supabase: PricesDb, userId: string, data: PriceRefreshFilter) {
  const { yahooSymbolFor, fetchYahoo, normalize, getRateToEUR } =
    await import("@/lib/yahoo.server");
  const { fetchMetalSpot } = await import("@/lib/metals.server");
  const { buybackDiscountOf } = await import("@/lib/metals");

  let query = supabase
    .from("assets")
    .select(
      "id, name, class, ticker, price_source, metal_type, buyback_discount, quantity, current_price, current_price_native, native_currency, status",
    )
    .eq("user_id", userId)
    .neq("status", "closed");
  if (data.class) query = query.eq("class", data.class);
  if (data.assetId) query = query.eq("id", data.assetId);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  type Row = NonNullable<typeof rows>[number];
  const targets = (rows ?? []).filter(
    (a) => a.class === "metal" || (a.class !== "p2p" && !!a.ticker),
  );
  const byId = new Map<string, Row>(targets.map((a) => [a.id, a]));

  const rateCache = new Map<string, number | null>();

  const assets: PriceablePosition[] = targets.map((a) => ({
    id: a.id,
    name: a.name,
    class: a.class,
    quantity: a.quantity,
    current_price: a.current_price,
    current_price_native: a.current_price_native,
    native_currency: a.native_currency,
  }));

  const outcome = await runPriceUpdate(
    assets,
    async (asset): Promise<Quote | null> => {
      const row = byId.get(asset.id);
      if (!row) return null;
      if (row.class === "metal")
        return fetchMetalSpot(
          row.metal_type,
          row.ticker,
          buybackDiscountOf(row.buyback_discount),
          rateCache,
        );
      const symbol = yahooSymbolFor(row);
      if (!symbol) return null;
      // 5 anos para ter histórico de dividendos suficiente para o yield estimado.
      const q = await fetchYahoo(symbol, "5y");
      if (!q) return null;
      const { price, currency, factor } = normalize(q);
      const { annualYieldPercent } = await import("@/lib/yield");
      const dividends = q.dividends.map((d) => ({ ...d, amount: d.amount * factor }));
      return {
        price,
        currency,
        source: `yahoo:${symbol}`,
        annualYield: annualYieldPercent(dividends, price),
      };
    },
    (currency) => getRateToEUR(currency, rateCache),
    async (asset, patch) => {
      const { error: upErr } = await supabase
        .from("assets")
        .update(patch)
        .eq("id", asset.id)
        .eq("user_id", userId);
      if (upErr) throw new Error(upErr.message);
    },
  );

  return {
    total: targets.length,
    updated: outcome.updated,
    failed: outcome.failed.map((f) => `${f.name}: ${f.error}`),
    results: outcome.results,
    finishedAt: new Date().toISOString(),
  };
}
