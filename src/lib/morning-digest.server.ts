/**
 * Resumo das 9h — leitura dos dados e cotações (só servidor).
 * Filtra sempre por `user_id`, para poder correr com o cliente de administração
 * (tarefa agendada), que não passa pelas regras RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/external-types";
import { addDaysISO } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { assetCurrentValue, isOpenPosition, type Asset } from "@/lib/portfolio-types";
import {
  buildMorningDigest,
  lastSessionChange,
  type DigestPosition,
  type MorningDigest,
} from "@/lib/morning-digest";

type Db = SupabaseClient<Database>;

/** Pequena concorrência para não sobrecarregar o Yahoo. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function loadMorningDigest(
  db: Db,
  userId: string,
  today: string,
): Promise<MorningDigest> {
  const { fetchYahooHistory, yahooSymbolFor } = await import("@/lib/yahoo.server");
  const { metalSymbol } = await import("@/lib/metals.server");

  const [assetsRes, divRes, snapRes] = await Promise.all([
    db.from("assets").select("*").eq("user_id", userId).neq("status", "closed"),
    db
      .from("dividends")
      .select("asset_name, ex_date, payment_date, paid_at, status")
      .eq("user_id", userId)
      .or(`ex_date.gte.${today},payment_date.gte.${today}`),
    db
      .from("portfolio_snapshots")
      .select("snapshot_date")
      .eq("user_id", userId)
      .eq("scope", "total")
      .order("snapshot_date", { ascending: false })
      .limit(1),
  ]);
  if (assetsRes.error) throw dbError(assetsRes.error);
  if (divRes.error) throw dbError(divRes.error);
  if (snapRes.error) throw dbError(snapRes.error);

  const assets = ((assetsRes.data ?? []) as unknown as Asset[]).filter(
    (a) => isOpenPosition(a) && a.class !== "p2p",
  );
  const from = addDaysISO(today, -12);

  const positions = await mapLimited(assets, 5, async (a): Promise<DigestPosition> => {
    const symbol = a.class === "metal" ? metalSymbol(a.metal_type, a.ticker) : yahooSymbolFor(a);
    const history = symbol ? await fetchYahooHistory(symbol, from, today) : null;
    return {
      name: a.name,
      ticker: a.class === "metal" ? (a.metal_type ?? a.name) : a.ticker,
      valueEUR: assetCurrentValue(a),
      priceEUR: Number(a.current_price) || 0,
      averagePriceEUR: Number(a.average_price) || 0,
      session: history ? lastSessionChange(history.points, today) : null,
      priceUpdatedAt: a.price_updated_at ?? null,
    };
  });

  const status = (s: string | null) => (s ?? "").toLowerCase();
  return buildMorningDigest({
    today,
    positions,
    dividends: (divRes.data ?? []).map((d) => ({
      assetName: d.asset_name,
      exDate: d.ex_date,
      paymentDate: d.payment_date,
      received:
        status(d.status) === "received" ||
        (!!d.payment_date && d.payment_date < today && status(d.status) !== "scheduled"),
    })),
    lastSnapshotDate: snapRes.data?.[0]?.snapshot_date ?? null,
  });
}
