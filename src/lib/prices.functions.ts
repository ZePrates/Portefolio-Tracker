import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Converte o ticker guardado (formato Base44) para o símbolo do Yahoo Finance. */
export function toYahooSymbol(ticker: string): string | null {
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
  name: string;
  dividends: Array<{ date: string; amount: number }>;
}

async function fetchYahoo(symbol: string, range = "1d"): Promise<YahooQuote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=${range}&events=div`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            currency?: string;
            longName?: string;
            shortName?: string;
          };
          events?: { dividends?: Record<string, { amount?: number; date?: number }> };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const meta = result?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
    const divs = Object.values(result?.events?.dividends ?? {})
      .filter((d) => typeof d.amount === "number" && typeof d.date === "number")
      .map((d) => ({
        date: new Date((d.date as number) * 1000).toISOString().slice(0, 10),
        amount: d.amount as number,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return {
      price,
      currency: (meta?.currency || "EUR").toUpperCase(),
      name: meta?.longName || meta?.shortName || symbol,
      dividends: divs,
    };
  } catch {
    return null;
  }
}

/** Normaliza cotações em cêntimos (GBX/ILA). */
function normalize(quote: YahooQuote): { price: number; currency: string; factor: number } {
  let price = quote.price;
  let cur = quote.currency;
  let factor = 1;
  if (cur === "GBX" || cur === "ILA") {
    factor = 0.01;
    price = price * factor;
    cur = cur === "GBX" ? "GBP" : "ILS";
  }
  return { price, currency: cur, factor };
}

async function getRateToEUR(
  currency: string,
  cache: Map<string, number | null>,
): Promise<number | null> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return 1;
  if (cache.has(cur)) return cache.get(cur) ?? null;
  const q = await fetchYahoo(`${cur}EUR=X`);
  const rate = q ? q.price : null;
  cache.set(cur, rate);
  return rate;
}

/** Procura no Yahoo Finance toda a informação de um ticker (preço, moeda, dividendos, yield). */
export const lookupTicker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticker: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
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
      last12.length >= 11 ? "Mensal" : last12.length >= 4 ? "Trimestral" : last12.length >= 2 ? "Semestral" : last12.length === 1 ? "Anual" : null;

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

/** Importa o histórico de dividendos do Yahoo para um ativo (evita duplicados). */
export const importDividendsForAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ assetId: z.string().uuid(), years: z.number().min(1).max(10).default(3) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: asset, error } = await context.supabase
      .from("assets")
      .select("id, ticker, name, quantity")
      .eq("id", data.assetId)
      .single();
    if (error) throw new Error(error.message);
    if (!asset?.ticker) throw new Error("Este ativo não tem ticker.");
    const symbol = toYahooSymbol(asset.ticker);
    if (!symbol) throw new Error("Ticker inválido.");

    const quote = await fetchYahoo(symbol, "5y");
    if (!quote) throw new Error(`Sem dados do Yahoo Finance para "${asset.ticker}".`);
    const { currency, factor } = normalize(quote);
    const rate = await getRateToEUR(currency, new Map());
    if (rate == null) throw new Error(`Sem taxa de câmbio para ${currency}.`);

    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - data.years);
    const iso = cutoff.toISOString().slice(0, 10);
    const qty = asset.quantity ?? 0;

    const { data: existing } = await context.supabase
      .from("dividends")
      .select("paid_at")
      .eq("asset_id", asset.id);
    const seen = new Set((existing ?? []).map((d) => d.paid_at));

    const rows = quote.dividends
      .filter((d) => d.date >= iso && !seen.has(d.date))
      .map((d) => ({
        user_id: context.userId,
        asset_id: asset.id,
        asset_name: asset.name,
        paid_at: d.date,
        per_share: d.amount * factor * rate,
        amount: d.amount * factor * rate * qty,
        source: "yahoo",
      }))
      .filter((r) => r.amount > 0);

    if (rows.length > 0) {
      const { error: insErr } = await context.supabase.from("dividends").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    await context.supabase
      .from("assets")
      .update({ last_dividend_import: new Date().toISOString() })
      .eq("id", asset.id);

    return { imported: rows.length };
  });

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
