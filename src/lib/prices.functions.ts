import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Converte o ticker guardado (formato Base44) para o símbolo do Yahoo Finance. */
function toYahooSymbol(ticker: string): string | null {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  if (t.endsWith(".US")) return t.slice(0, -3);
  if (t.endsWith(".UK")) return `${t.slice(0, -3)}.L`;
  if (t.endsWith(".NL")) return `${t.slice(0, -3)}.AS`;
  return t;
}

interface YahooQuote {
  price: number;
  currency: string;
}

async function fetchYahoo(symbol: string): Promise<YahooQuote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=5d`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; currency?: string } }> };
    };
    const meta = json.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
    return { price, currency: (meta?.currency || "EUR").toUpperCase() };
  } catch {
    return null;
  }
}

async function getRateToEUR(currency: string, cache: Map<string, number | null>): Promise<number | null> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return 1;
  if (cache.has(cur)) return cache.get(cur) ?? null;
  // GBp (pence) usado por várias bolsas de Londres
  if (cur === "GBP" || cur === "GBX" || cur === "GBP_PENCE") {
    const q = await fetchYahoo("GBPEUR=X");
    const rate = q ? q.price : null;
    cache.set(cur, rate);
    return rate;
  }
  const q = await fetchYahoo(`${cur}EUR=X`);
  const rate = q ? q.price : null;
  cache.set(cur, rate);
  return rate;
}

export const refreshPricesFromYahoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ class: z.string().nullable().default(null) }).parse(input ?? { class: null }),
  )
  .handler(async ({ data, context }) => {
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
      let price = quote.price;
      let cur = quote.currency;
      if (cur === "GBP" && symbol.endsWith(".L")) {
        // Yahoo devolve pence em algumas cotações de Londres
        cur = "GBP";
      }
      if (cur === "GBX" || cur === "ILA") {
        price = price / 100;
        cur = cur === "GBX" ? "GBP" : "ILS";
      }
      const rate = await getRateToEUR(cur, rateCache);
      if (rate == null) {
        failed.push(a.ticker as string);
        continue;
      }
      const priceEur = price * rate;
      const { error: upErr } = await context.supabase
        .from("assets")
        .update({
          current_price: priceEur,
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
