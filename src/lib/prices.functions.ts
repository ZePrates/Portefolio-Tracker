import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { takeSnapshot, type SB } from "@/lib/snapshots.functions";
import type { PricesDb } from "@/lib/prices.server";

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

    const { annualYieldPercent, frequencyLabel, inferPaymentsPerYear, ttmDividends } =
      await import("@/lib/yield");
    const ttm = ttmDividends(dividends);
    // Quando faltam pagamentos no último ano, anualiza o dividendo mais recente.
    const annualYield = annualYieldPercent(dividends, price);
    const frequency = frequencyLabel(inferPaymentsPerYear(dividends));

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
 * Atualização central de preços: títulos não-ETF (Yahoo Finance) e metais (futuros spot Yahoo),
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
    const { refreshPrices } = await import("@/lib/prices.server");
    const result = await refreshPrices(
      context.supabase as unknown as PricesDb,
      context.userId,
      data,
    );
    await takeSnapshot(context.supabase as unknown as SB, context.userId);
    return result;
  });
