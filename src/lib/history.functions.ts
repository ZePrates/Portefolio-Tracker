import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { addDaysISO, isoDateLisbon, todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import {
  rebuildHistory,
  type DatedValue,
  type PriceHistory,
  type RebuildAsset,
} from "@/lib/history-rebuild";

/** Pedidos ao Yahoo em simultâneo (a mesma ordem de grandeza da atualização de cotações). */
const FETCH_CONCURRENCY = 8;
const WRITE_CHUNK = 500;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Reconstrói as fotografias diárias, desde o primeiro movimento até ontem, a
 * partir do livro de movimentos e dos fechos históricos do Yahoo (ver
 * `rebuildHistory`). Substitui as fotografias anteriores a hoje, incluindo
 * as da app e as importadas, para a série ser toda calculada da mesma forma.
 * A fotografia de hoje fica como está.
 */
export const rebuildPortfolioHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const today = todayLisbon();
    const to = addDaysISO(today, -1);

    const [assetsRes, txRes, dedRes, p2pRes] = await Promise.all([
      sb
        .from("assets")
        .select("id, class, name, ticker, price_source, metal_type, buyback_discount"),
      sb.from("transactions").select("asset_id, type, traded_at, quantity, total, realized_pl"),
      sb
        .from("asset_expenses")
        .select("asset_id, incurred_at, grams_deducted")
        .not("grams_deducted", "is", null),
      sb.from("p2p_cash_movements").select("asset_id, occurred_on, type, amount"),
    ]);
    for (const r of [assetsRes, txRes, dedRes, p2pRes]) if (r.error) throw dbError(r.error);

    const { yahooSymbolFor, fetchYahooHistory } = await import("@/lib/yahoo.server");
    const { metalSymbol } = await import("@/lib/metals.server");
    const { buybackDiscountOf } = await import("@/lib/metals");

    const assets: RebuildAsset[] = (assetsRes.data ?? []).map((a) => ({
      id: a.id,
      class: a.class,
      name: a.ticker || a.name,
      symbol:
        a.class === "p2p"
          ? null
          : a.class === "metal"
            ? (yahooSymbolFor(a) ?? metalSymbol(a.metal_type, a.ticker))
            : yahooSymbolFor(a),
      buybackDiscount: a.class === "metal" ? buybackDiscountOf(a.buyback_discount) : undefined,
    }));
    const transactions = (txRes.data ?? []).flatMap((t) =>
      t.asset_id
        ? [
            {
              assetId: t.asset_id,
              type: t.type,
              date: isoDateLisbon(new Date(t.traded_at)),
              quantity: Number(t.quantity) || 0,
              total: Number(t.total) || 0,
              realizedPl: t.realized_pl == null ? null : Number(t.realized_pl),
            },
          ]
        : [],
    );
    const firstTrade = transactions.reduce<string | null>(
      (acc, t) => (!acc || t.date < acc ? t.date : acc),
      null,
    );

    // Fechos de cada símbolo e, depois, o câmbio de cada moeda que apareceu.
    const prices = new Map<string, PriceHistory>();
    const symbols = [...new Set(assets.map((a) => a.symbol).filter((s): s is string => !!s))];
    const from = firstTrade ?? to;
    await mapLimit(symbols, FETCH_CONCURRENCY, async (s) => {
      const h = await fetchYahooHistory(s, from, to);
      if (h) prices.set(s, h);
    });
    const fx = new Map<string, DatedValue[]>();
    const currencies = [...new Set([...prices.values()].map((p) => p.currency))].filter(
      (c) => c !== "EUR",
    );
    await mapLimit(currencies, FETCH_CONCURRENCY, async (c) => {
      const h = await fetchYahooHistory(`${c}EUR=X`, from, to);
      if (h) fx.set(c, h.points);
    });

    const result = rebuildHistory({
      assets,
      transactions,
      gramDeductions: (dedRes.data ?? []).flatMap((d) =>
        d.asset_id
          ? [
              {
                assetId: d.asset_id,
                date: String(d.incurred_at).slice(0, 10),
                grams: Number(d.grams_deducted) || 0,
              },
            ]
          : [],
      ),
      p2pCash: (p2pRes.data ?? []).map((m) => ({
        assetId: m.asset_id,
        date: String(m.occurred_on).slice(0, 10),
        type: m.type,
        amount: Number(m.amount) || 0,
      })),
      prices,
      fx,
      to,
    });

    const rows = result.rows.map((r) => ({
      user_id: context.userId,
      snapshot_date: r.date,
      scope: r.scope,
      invested_amount: r.invested,
      market_value: r.value,
      source: "rebuild",
    }));
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const { error } = await sb
        .from("portfolio_snapshots")
        .upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: "user_id,snapshot_date,scope" });
      if (error) throw dbError(error);
    }
    // O que ficou antes de hoje e não foi reescrito (âmbitos ou dias que a
    // reconstrução não produz) já não bate com a série nova.
    if (rows.length > 0) {
      const { error } = await sb
        .from("portfolio_snapshots")
        .delete()
        .lt("snapshot_date", today)
        .neq("source", "rebuild");
      if (error) throw dbError(error);
      const { error: oldError } = await sb
        .from("portfolio_snapshots")
        .delete()
        .eq("source", "rebuild")
        .lt("snapshot_date", result.from ?? today);
      if (oldError) throw dbError(oldError);
    }

    return {
      days: new Set(result.rows.map((r) => r.date)).size,
      from: result.from,
      to: result.to,
      atCost: result.atCost,
      missingFx: result.missingFx,
      missingPrices: symbols.filter((s) => !prices.has(s)),
    };
  });
