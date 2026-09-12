import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { runPriceUpdate, type PriceablePosition, type Quote } from "@/lib/prices";

export { toYahooSymbol } from "@/lib/yahoo";

/** Procura no Yahoo Finance toda a informação de um ticker (preço, moeda, dividendos, yield). */
export const lookupTicker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticker: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { toYahooSymbol, fetchYahoo, normalize, getRateToEUR } =
      await import("@/lib/yahoo.server");
    const symbol = toYahooSymbol(data.ticker);
    if (!symbol) throw new Error("Ticker inválido.");
    const quote = await fetchYahoo(symbol, "5y");
    if (!quote) throw new Error(`Sem cotação no Yahoo Finance para "${data.ticker}".`);
    const { price, currency, factor } = normalize(quote);
    const rate = await getRateToEUR(currency, new Map());
    const dividends = quote.dividends.map((d) => ({ ...d, amount: d.amount * factor }));

    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const iso = cutoff.toISOString().slice(0, 10);
    const last12 = dividends.filter((d) => d.date >= iso);
    const ttm = last12.reduce((s, d) => s + d.amount, 0);
    const annualYield = price > 0 && ttm > 0 ? (ttm / price) * 100 : null;
    const frequency =
      last12.length >= 11
        ? "Mensal"
        : last12.length >= 4
          ? "Trimestral"
          : last12.length >= 2
            ? "Semestral"
            : last12.length === 1
              ? "Anual"
              : null;

    return {
      symbol,
      name: quote.name,
      currency,
      price,
      rate,
      priceEur: rate != null ? price * rate : null,
      annualYield,
      frequency,
      dividendsPerShareTTM: ttm,
      dividends: dividends.slice(-40),
    };
  });

/**
 * Atualização central de preços: títulos (Yahoo Finance) e metais (futuros spot Yahoo),
 * com câmbio real para EUR. Um ativo que falhe não interrompe os restantes e o
 * último preço válido nunca é substituído por 0/null.
 */
export const updateAllPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        class: z.string().nullable().default(null),
        assetId: z.string().uuid().nullable().default(null),
      })
      .parse(input ?? { class: null, assetId: null }),
  )
  .handler(async ({ data, context }) => {
    const { toYahooSymbol, fetchYahoo, normalize, getRateToEUR } =
      await import("@/lib/yahoo.server");
    const { fetchMetalSpot } = await import("@/lib/metals.server");

    let query = context.supabase
      .from("assets")
      .select(
        "id, name, class, ticker, metal_type, quantity, current_price, current_price_native, native_currency, status",
      )
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
        if (row.class === "metal") return fetchMetalSpot(row.metal_type, row.ticker);
        const symbol = toYahooSymbol(row.ticker ?? "");
        if (!symbol) return null;
        const q = await fetchYahoo(symbol);
        if (!q) return null;
        const { price, currency } = normalize(q);
        return { price, currency, source: `yahoo:${symbol}` };
      },
      (currency) => getRateToEUR(currency, rateCache),
      async (asset, patch) => {
        const { error: upErr } = await context.supabase
          .from("assets")
          .update(patch)
          .eq("id", asset.id);
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
  });

/** Alias retrocompatível. */
export const refreshPricesFromYahoo = updateAllPrices;
