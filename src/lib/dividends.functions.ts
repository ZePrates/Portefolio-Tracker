import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeDividendHistory, type DividendTrade, type DividendEventInput } from "@/lib/dividends";

const YAHOO_SOURCE = "yahoo";

interface SyncOutcome {
  assetId: string;
  assetName: string;
  status: "ok" | "unavailable" | "skipped";
  reason?: string;
  inserted: number;
  updated: number;
}

/**
 * Sincroniza os dividendos de um ativo a partir do Yahoo Finance.
 * Idempotente: identifica cada evento por `source_event_id` e nunca duplica.
 * A quantidade elegível é sempre reconstruída a partir do histórico de compras/vendas.
 */
async function syncAsset(
  supabase: any,
  userId: string,
  asset: {
    id: string;
    name: string;
    ticker: string | null;
    class: string;
  },
  fxCache: Map<string, number | null>,
): Promise<SyncOutcome> {
  const base = { assetId: asset.id, assetName: asset.name, inserted: 0, updated: 0 };
  if (!asset.ticker) return { ...base, status: "skipped", reason: "Ativo sem ticker." };

  const { toYahooSymbol, fetchYahoo, normalize, getRateOnDate, getRateToEUR } = await import(
    "@/lib/yahoo.server"
  );
  const symbol = toYahooSymbol(asset.ticker);
  if (!symbol) return { ...base, status: "skipped", reason: "Ticker inválido." };

  const { data: txs, error: txErr } = await supabase
    .from("transactions")
    .select("type, quantity, traded_at, created_at")
    .eq("asset_id", asset.id);
  if (txErr) throw new Error(txErr.message);
  const trades: DividendTrade[] = (txs ?? []).map((t: any) => ({
    type: t.type,
    quantity: Number(t.quantity),
    traded_at: String(t.traded_at).slice(0, 10),
    created_at: t.created_at ?? undefined,
  }));
  if (trades.length === 0) {
    return { ...base, status: "skipped", reason: "Sem histórico de compras registado." };
  }

  const quote = await fetchYahoo(symbol, "10y");
  if (!quote) return { ...base, status: "unavailable", reason: "Sem dados do Yahoo Finance." };
  const { currency, factor } = normalize(quote);

  const today = new Date().toISOString().slice(0, 10);
  const events: DividendEventInput[] = [];
  for (const d of quote.dividends) {
    const perShareNative = d.amount * factor;
    if (!(perShareNative > 0)) continue;
    let rate = await getRateOnDate(currency, d.date, fxCache);
    if (rate == null) rate = await getRateToEUR(currency, fxCache);
    if (rate == null) continue; // sem taxa fiável: não inventar valor
    events.push({
      exDate: d.date,
      // O Yahoo só publica distribuições já efetivadas (com a respetiva ex-date);
      // para eventos passados a ex-date é a data efetiva conhecida. Para eventos
      // futuros NÃO se inventa data de pagamento: ficam por confirmar.
      paymentDate: d.date <= today ? d.date : null,
      perShareNative,
      currency,
      fxRate: rate,
      fxDate: d.date,
    });
  }


  const computed = computeDividendHistory(trades, events, today);

  const { data: existing, error: exErr } = await supabase
    .from("dividends")
    .select("id, source, source_event_id, ex_date")
    .eq("asset_id", asset.id);
  if (exErr) throw new Error(exErr.message);

  const byEventId = new Map<string, any>();
  const byExDate = new Map<string, any>();
  for (const row of existing ?? []) {
    if (row.source_event_id) byEventId.set(row.source_event_id, row);
    if (row.ex_date) byExDate.set(row.ex_date, row);
  }

  let inserted = 0;
  let updated = 0;
  for (const c of computed) {
    const eventId = `${YAHOO_SOURCE}:${symbol}:${c.exDate}`;
    const row = {
      user_id: userId,
      asset_id: asset.id,
      asset_name: asset.name,
      ex_date: c.exDate,
      payment_date: c.paymentDate,
      paid_at: c.paymentDate ?? c.exDate,
      currency: c.currency,
      per_share: c.perShareNative * c.fxRate,
      per_share_native: c.perShareNative,
      eligible_quantity: c.eligibleQuantity,
      amount_native: c.amountNative,
      fx_rate: c.fxRate,
      fx_date: c.fxDate,
      gross_amount: c.grossAmount,
      net_amount: c.netAmount,
      amount: c.grossAmount,
      status: c.status,
      source: YAHOO_SOURCE,
      source_event_id: eventId,
    };
    const match = byEventId.get(eventId) ?? byExDate.get(c.exDate);
    if (match) {
      if (match.source && match.source !== YAHOO_SOURCE) continue; // não sobrepor registos manuais
      const { error } = await supabase.from("dividends").update(row).eq("id", match.id);
      if (error) throw new Error(error.message);
      updated += 1;
    } else {
      const { error } = await supabase.from("dividends").insert(row);
      if (error && !String(error.message).includes("duplicate key")) throw new Error(error.message);
      if (!error) inserted += 1;
    }
  }

  await supabase
    .from("assets")
    .update({ last_dividend_sync: new Date().toISOString(), last_dividend_import: new Date().toISOString() })
    .eq("id", asset.id);

  return { ...base, status: "ok", inserted, updated };
}

export const syncDividendsForAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ assetId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: asset, error } = await context.supabase
      .from("assets")
      .select("id, name, ticker, class")
      .eq("id", data.assetId)
      .single();
    if (error || !asset) throw new Error(error?.message ?? "Ativo não encontrado.");
    return syncAsset(context.supabase, context.userId, asset as any, new Map());
  });

/** Sincroniza todos os ativos com ticker (opcionalmente de uma classe). */
export const syncAllDividends = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ class: z.string().nullable().default(null) })
      .default({ class: null })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("assets")
      .select("id, name, ticker, class")
      .not("ticker", "is", null);
    if (data.class) q = q.eq("class", data.class);
    const { data: assets, error } = await q;
    if (error) throw new Error(error.message);

    const targets = (assets ?? []).filter((a) => a.class !== "p2p" && a.class !== "metal");
    const fxCache = new Map<string, number | null>();
    const results: SyncOutcome[] = [];
    for (const a of targets) {
      try {
        results.push(await syncAsset(context.supabase, context.userId, a as any, fxCache));
      } catch (e) {
        results.push({
          assetId: a.id,
          assetName: a.name,
          status: "unavailable",
          reason: e instanceof Error ? e.message : "Erro desconhecido",
          inserted: 0,
          updated: 0,
        });
      }
    }
    return {
      syncedAt: new Date().toISOString(),
      assets: results.length,
      inserted: results.reduce((s, r) => s + r.inserted, 0),
      updated: results.reduce((s, r) => s + r.updated, 0),
      unavailable: results.filter((r) => r.status === "unavailable").map((r) => r.assetName),
      results,
    };
  });

/**
 * Auditoria/recálculo: recalcula a quantidade elegível e os valores de todos
 * os dividendos automáticos com base no histórico real de posições.
 * Não apaga registos manuais nem histórico.
 */
export const recalculateDividends = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("dividends")
      .select("*")
      .eq("source", YAHOO_SOURCE);
    if (error) throw new Error(error.message);

    const today = new Date().toISOString().slice(0, 10);
    const tradesByAsset = new Map<string, DividendTrade[]>();
    let corrected = 0;
    let dropped = 0;

    for (const d of rows ?? []) {
      if (!d.asset_id || !d.ex_date) continue;
      if (!tradesByAsset.has(d.asset_id)) {
        const { data: txs } = await context.supabase
          .from("transactions")
          .select("type, quantity, traded_at, created_at")
          .eq("asset_id", d.asset_id);
        tradesByAsset.set(
          d.asset_id,
          (txs ?? []).map((t) => ({
            type: t.type,
            quantity: Number(t.quantity),
            traded_at: String(t.traded_at).slice(0, 10),
            created_at: t.created_at ?? undefined,
          })),
        );
      }
      const trades = tradesByAsset.get(d.asset_id)!;
      const perShareNative = Number(d.per_share_native ?? d.per_share ?? 0);
      const rate = Number(d.fx_rate ?? 1) || 1;
      const [computed] = computeDividendHistory(
        trades,
        [
          {
            exDate: d.ex_date,
            paymentDate: d.payment_date ?? d.paid_at,
            perShareNative,
            currency: d.currency ?? "EUR",
            fxRate: rate,
            fxDate: d.fx_date ?? null,
          },
        ],
        today,
      );

      if (!computed) {
        // Sem posição elegível: mantém o histórico mas zera o valor contabilizado.
        await context.supabase
          .from("dividends")
          .update({ eligible_quantity: 0, amount: 0, gross_amount: 0, net_amount: 0, status: "unknown" })
          .eq("id", d.id);
        dropped += 1;
        continue;
      }

      const changed =
        Math.abs(Number(d.eligible_quantity ?? -1) - computed.eligibleQuantity) > 1e-6 ||
        Math.abs(Number(d.gross_amount ?? d.amount ?? 0) - computed.grossAmount) > 1e-6 ||
        d.status !== computed.status;
      if (!changed) continue;

      const { error: upErr } = await context.supabase
        .from("dividends")
        .update({
          eligible_quantity: computed.eligibleQuantity,
          amount_native: computed.amountNative,
          gross_amount: computed.grossAmount,
          net_amount: computed.netAmount,
          amount: computed.grossAmount,
          status: computed.status,
        })
        .eq("id", d.id);
      if (upErr) throw new Error(upErr.message);
      corrected += 1;
    }

    return { reviewed: (rows ?? []).length, corrected, dropped };
  });

/**
 * Auditoria só de leitura: verifica todos os registos face ao ledger real
 * e devolve os problemas encontrados (sem alterar dados).
 */
export const auditDividends = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { auditDividendRecord, findDuplicateGroups } = await import("@/lib/dividends");
    const { data: rows, error } = await context.supabase.from("dividends").select("*");
    if (error) throw new Error(error.message);

    const today = new Date().toISOString().slice(0, 10);
    const tradesByAsset = new Map<string, DividendTrade[]>();
    const findings: Array<{ id: string; assetName: string; exDate: string | null; issues: string[] }> = [];

    for (const d of rows ?? []) {
      let trades: DividendTrade[] = [];
      if (d.asset_id) {
        if (!tradesByAsset.has(d.asset_id)) {
          const { data: txs } = await context.supabase
            .from("transactions")
            .select("type, quantity, traded_at, created_at")
            .eq("asset_id", d.asset_id);
          tradesByAsset.set(
            d.asset_id,
            (txs ?? []).map((t) => ({
              type: t.type,
              quantity: Number(t.quantity),
              traded_at: String(t.traded_at).slice(0, 10),
              created_at: t.created_at ?? undefined,
            })),
          );
        }
        trades = tradesByAsset.get(d.asset_id)!;
      }
      const { issues } = auditDividendRecord(d as never, trades, today);
      if (issues.length > 0) {
        findings.push({
          id: d.id,
          assetName: d.asset_name,
          exDate: d.ex_date ?? null,
          issues,
        });
      }
    }

    const duplicates = findDuplicateGroups((rows ?? []) as never[]).map((g) => ({
      assetName: (g[0] as any).asset_name as string,
      exDate: ((g[0] as any).ex_date ?? (g[0] as any).paid_at) as string,
      count: g.length,
    }));

    return { reviewed: (rows ?? []).length, findings, duplicates, auditedAt: new Date().toISOString() };
  });
