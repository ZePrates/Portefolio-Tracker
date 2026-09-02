import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export { toYahooSymbol } from "@/lib/yahoo";

/** Procura no Yahoo Finance toda a informação de um ticker (preço, moeda, dividendos, yield). */
export const lookupTicker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticker: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { toYahooSymbol, fetchYahoo, normalize, getRateToEUR } = await import("@/lib/yahoo.server");
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

export const refreshPricesFromYahoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ class: z.string().nullable().default(null) }).parse(input ?? { class: null }),
  )
  .handler(async ({ data, context }) => {
    const { toYahooSymbol, fetchYahoo, normalize, getRateToEUR } = await import("@/lib/yahoo.server");
    let query = context.supabase
      .from("assets")
      .select("id, ticker, quantity, class, current_price")
      .not("ticker", "is", null);
    if (data.class) query = query.eq("class", data.class);

    const { data: assets, error } = await query;
    if (error) throw new Error(error.message);

    const securities = (assets ?? []).filter(
      (a) => a.class !== "p2p" && a.class !== "metal" && a.ticker,
    );

    const rateCache = new Map<string, number | null>();
    let updated = 0;
    const failed: string[] = [];

    for (const a of securities) {
      const symbol = toYahooSymbol(a.ticker as string);
      if (!symbol) continue;
      const quote = await fetchYahoo(symbol);
      if (!quote) {
        failed.push(a.ticker as string);
        continue;
      }
      const { price, currency } = normalize(quote);
      const rate = await getRateToEUR(currency, rateCache);
      if (rate == null) {
        failed.push(a.ticker as string);
        continue;
      }
      const priceEur = price * rate;
      const { error: upErr } = await context.supabase
        .from("assets")
        .update({
          current_price: priceEur,
          current_price_native: price,
          native_currency: currency,
          current_value: (a.quantity ?? 0) * priceEur,
        })
        .eq("id", a.id);
      if (upErr) {
        failed.push(a.ticker as string);
        continue;
      }
      updated += 1;
    }

    return { updated, failed, total: securities.length };
  });
