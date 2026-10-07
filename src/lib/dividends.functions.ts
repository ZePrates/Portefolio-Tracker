import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import {
  computeDividendHistory,
  type DividendTrade,
  type DividendEventInput,
  type AuditableDividend,
} from "@/lib/dividends";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import {
  estimatePaymentDate,
  withholdingAmount,
  withholdingRateFor,
  type TaxableAsset,
} from "@/lib/tax";

const YAHOO_SOURCE = "yahoo";

type SB = SupabaseClient<Database>;

interface SyncOutcome {
  assetId: string;
  assetName: string;
  status: "ok" | "unavailable" | "skipped";
  reason?: string;
  inserted: number;
  updated: number;
}

interface TransactionRow {
  asset_id?: string | null;
  type: string;
  quantity: number | string;
  traded_at: string;
  created_at?: string | null;
}

interface ExistingDividendRow {
  id: string;
  source: string;
  source_event_id: string | null;
  ex_date: string | null;
  payment_date_estimated: boolean;
}

interface DividendRow extends AuditableDividend {
  id: string;
  asset_id: string | null;
}

interface SyncAsset extends TaxableAsset {
  id: string;
  name: string;
  ticker: string | null;
  price_source?: string | null;
}

const ASSET_COLUMNS = "id, name, ticker, price_source, class, isin, withholding_rate";

function toTrade(t: TransactionRow): DividendTrade {
  return {
    type: t.type,
    quantity: Number(t.quantity),
    traded_at: String(t.traded_at).slice(0, 10),
    ...(t.created_at != null ? { created_at: t.created_at } : {}),
  };
}

/** Livro de movimentos de vários ativos numa só consulta (evita N+1). */
async function loadTradesByAsset(
  supabase: SB,
  assetIds: string[],
): Promise<Map<string, DividendTrade[]>> {
  const map = new Map<string, DividendTrade[]>();
  if (assetIds.length === 0) return map;
  const { data, error } = await supabase
    .from("transactions")
    .select("asset_id, type, quantity, traded_at, created_at")
    .in("asset_id", assetIds);
  if (error) throw dbError(error);
  for (const t of data ?? []) {
    if (!t.asset_id) continue;
    const list = map.get(t.asset_id) ?? [];
    list.push(toTrade(t));
    map.set(t.asset_id, list);
  }
  return map;
}

/** Domicílio conhecido pelos perfis de ETF (asset_profiles.domicile_country). */
async function loadDomiciles(supabase: SB, assetIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (assetIds.length === 0) return map;
  const { data } = await supabase
    .from("asset_profiles")
    .select("asset_id, domicile_country")
    .in("asset_id", assetIds);
  for (const p of data ?? []) if (p.domicile_country) map.set(p.asset_id, p.domicile_country);
  return map;
}

/**
 * Sincroniza os dividendos de um ativo a partir do Yahoo Finance.
 * Idempotente: identifica cada evento por `source_event_id` e nunca duplica.
 * A quantidade elegível é sempre reconstruída a partir do histórico de compras/vendas.
 * O Yahoo só publica a ex-date: a data de pagamento é estimada (sinalizada) e a
 * retenção na fonte é a do ativo ou a do país de domicílio (ver `lib/tax.ts`).
 * Registos confirmados (manuais, importados do broker) nunca são sobrepostos.
 */
async function syncAsset(
  supabase: SB,
  userId: string,
  asset: SyncAsset,
  trades: DividendTrade[],
  fxCache: Map<string, number | null>,
): Promise<SyncOutcome> {
  const base = { assetId: asset.id, assetName: asset.name, inserted: 0, updated: 0 };
  if (!asset.ticker) return { ...base, status: "skipped", reason: "Ativo sem ticker." };

  const { yahooSymbolFor, fetchYahoo, normalize, getRateOnDate, getRateToEUR } =
    await import("@/lib/yahoo.server");
  const symbol = yahooSymbolFor(asset);
  if (!symbol) return { ...base, status: "skipped", reason: "Ticker inválido." };

  if (trades.length === 0) {
    return { ...base, status: "skipped", reason: "Sem histórico de compras registado." };
  }

  const quote = await fetchYahoo(symbol, "10y");
  if (!quote) return { ...base, status: "unavailable", reason: "Sem dados do Yahoo Finance." };
  const { currency, factor } = normalize(quote);

  const today = todayLisbon();
  const events: DividendEventInput[] = [];
  for (const d of quote.dividends) {
    const perShareNative = d.amount * factor;
    if (!(perShareNative > 0)) continue;
    let rate = await getRateOnDate(currency, d.date, fxCache);
    if (rate == null) rate = await getRateToEUR(currency, fxCache);
    if (rate == null) continue; // sem taxa fiável: não inventar valor
    events.push({
      exDate: d.date,
      paymentDate: estimatePaymentDate(d.date),
      perShareNative,
      currency,
      fxRate: rate,
      fxDate: d.date,
    });
  }

  const computed = computeDividendHistory(trades, events, today);
  const wht = withholdingRateFor(asset);

  const { data: existing, error: exErr } = await supabase
    .from("dividends")
    .select("id, source, source_event_id, ex_date, payment_date_estimated")
    .eq("asset_id", asset.id);
  if (exErr) throw dbError(exErr);

  const byEventId = new Map<string, ExistingDividendRow>();
  const byExDate = new Map<string, ExistingDividendRow>();
  for (const row of existing ?? []) {
    if (row.source_event_id) byEventId.set(row.source_event_id, row);
    if (row.ex_date) byExDate.set(row.ex_date, row);
  }

  let inserted = 0;
  let updated = 0;
  for (const c of computed) {
    const eventId = `${YAHOO_SOURCE}:${symbol}:${c.exDate}`;
    const tax = withholdingAmount(c.grossAmount, wht.rate);
    const row = {
      user_id: userId,
      asset_id: asset.id,
      asset_name: asset.name,
      ex_date: c.exDate,
      payment_date: c.paymentDate,
      payment_date_estimated: true,
      paid_at: c.paymentDate ?? c.exDate,
      currency: c.currency,
      per_share: c.perShareNative * c.fxRate,
      per_share_native: c.perShareNative,
      eligible_quantity: c.eligibleQuantity,
      amount_native: c.amountNative,
      fx_rate: c.fxRate,
      fx_date: c.fxDate,
      gross_amount: c.grossAmount,
      tax_amount: tax,
      net_amount: c.grossAmount - tax - c.feeAmount,
      amount: c.grossAmount,
      status: c.status,
      source: YAHOO_SOURCE,
      source_event_id: eventId,
    };
    const match = byEventId.get(eventId) ?? byExDate.get(c.exDate);
    if (match) {
      // Não sobrepor registos manuais ou confirmados pelo extrato do broker.
      if (match.source && match.source !== YAHOO_SOURCE) continue;
      if (!match.payment_date_estimated) continue;
      const { error } = await supabase.from("dividends").update(row).eq("id", match.id);
      if (error) throw dbError(error);
      updated += 1;
    } else {
      const { error } = await supabase.from("dividends").insert(row);
      if (error && error.code !== "23505") throw dbError(error);
      if (!error) inserted += 1;
    }
  }

  const now = new Date().toISOString();
  await supabase
    .from("assets")
    .update({ last_dividend_sync: now, last_dividend_import: now })
    .eq("id", asset.id);

  return { ...base, status: "ok", inserted, updated };
}

export const syncDividendsForAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ assetId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: asset, error } = await context.supabase
      .from("assets")
      .select(ASSET_COLUMNS)
      .eq("id", data.assetId)
      .single();
    if (error || !asset) throw dbError(error, "Ativo não encontrado.");
    const [trades, domiciles] = await Promise.all([
      loadTradesByAsset(context.supabase, [asset.id]),
      loadDomiciles(context.supabase, [asset.id]),
    ]);
    return syncAsset(
      context.supabase,
      context.userId,
      { ...asset, domicile: domiciles.get(asset.id) ?? null },
      trades.get(asset.id) ?? [],
      new Map(),
    );
  });

/** Sincroniza todos os ativos com ticker (opcionalmente de uma classe). */
export const syncAllDividends = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ class: z.string().max(32).nullable().default(null) })
      .default({ class: null })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("assets").select(ASSET_COLUMNS).not("ticker", "is", null);
    if (data.class) q = q.eq("class", data.class);
    const { data: assets, error } = await q;
    if (error) throw dbError(error);

    const targets = (assets ?? []).filter((a) => a.class !== "p2p" && a.class !== "metal");
    const ids = targets.map((a) => a.id);
    const [tradesByAsset, domiciles] = await Promise.all([
      loadTradesByAsset(context.supabase, ids),
      loadDomiciles(context.supabase, ids),
    ]);
    const fxCache = new Map<string, number | null>();
    const results: SyncOutcome[] = [];
    for (const a of targets) {
      try {
        results.push(
          await syncAsset(
            context.supabase,
            context.userId,
            { ...a, domicile: domiciles.get(a.id) ?? null },
            tradesByAsset.get(a.id) ?? [],
            fxCache,
          ),
        );
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
 * Auditoria/recálculo: recalcula a quantidade elegível, a retenção na fonte,
 * a data de pagamento estimada e os valores de todos os dividendos automáticos
 * com base no histórico real de posições. Não apaga registos manuais nem histórico
 * e não toca em registos confirmados pelo broker.
 */
export const recalculateDividends = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("dividends")
      .select("*")
      .eq("source", YAHOO_SOURCE);
    if (error) throw dbError(error);

    const ids = [...new Set((rows ?? []).map((d) => d.asset_id).filter((x): x is string => !!x))];
    const [tradesByAsset, domiciles, assetsRes] = await Promise.all([
      loadTradesByAsset(context.supabase, ids),
      loadDomiciles(context.supabase, ids),
      ids.length
        ? context.supabase.from("assets").select(ASSET_COLUMNS).in("id", ids)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (assetsRes.error) throw dbError(assetsRes.error);
    const assetById = new Map((assetsRes.data ?? []).map((a) => [a.id, a]));

    const today = todayLisbon();
    let corrected = 0;
    let dropped = 0;

    for (const d of rows ?? []) {
      if (!d.asset_id || !d.ex_date) continue;
      const trades = tradesByAsset.get(d.asset_id) ?? [];
      const asset = assetById.get(d.asset_id);
      const perShareNative = Number(d.per_share_native ?? d.per_share ?? 0);
      const rate = Number(d.fx_rate ?? 1) || 1;
      const paymentDate = d.payment_date_estimated
        ? estimatePaymentDate(d.ex_date)
        : (d.payment_date ?? d.paid_at);
      const [computed] = computeDividendHistory(
        trades,
        [
          {
            exDate: d.ex_date,
            paymentDate,
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
        const { error: zErr } = await context.supabase
          .from("dividends")
          .update({
            eligible_quantity: 0,
            amount: 0,
            gross_amount: 0,
            tax_amount: 0,
            net_amount: 0,
            status: "unknown",
          })
          .eq("id", d.id);
        if (zErr) throw dbError(zErr);
        dropped += 1;
        continue;
      }

      const wht = asset
        ? withholdingRateFor({ ...asset, domicile: domiciles.get(asset.id) ?? null })
        : { rate: 0 };
      const tax = withholdingAmount(computed.grossAmount, wht.rate);
      const net = computed.grossAmount - tax - Number(d.fee_amount ?? 0);
      const changed =
        Math.abs(Number(d.eligible_quantity ?? -1) - computed.eligibleQuantity) > 1e-6 ||
        Math.abs(Number(d.gross_amount ?? d.amount ?? 0) - computed.grossAmount) > 1e-6 ||
        Math.abs(Number(d.tax_amount ?? 0) - tax) > 1e-6 ||
        Math.abs(Number(d.net_amount ?? 0) - net) > 1e-6 ||
        (d.payment_date ?? null) !== paymentDate ||
        d.status !== computed.status;
      if (!changed) continue;

      const { error: upErr } = await context.supabase
        .from("dividends")
        .update({
          eligible_quantity: computed.eligibleQuantity,
          amount_native: computed.amountNative,
          gross_amount: computed.grossAmount,
          tax_amount: tax,
          net_amount: net,
          amount: computed.grossAmount,
          payment_date: paymentDate,
          paid_at: paymentDate,
          status: computed.status,
        })
        .eq("id", d.id);
      if (upErr) throw dbError(upErr);
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
    const { data, error } = await context.supabase.from("dividends").select("*");
    if (error) throw dbError(error);
    const rows = (data ?? []) as DividendRow[];

    const today = todayLisbon();
    const ids = [...new Set(rows.map((d) => d.asset_id).filter((x): x is string => !!x))];
    const tradesByAsset = await loadTradesByAsset(context.supabase, ids);
    const findings: Array<{
      id: string;
      assetName: string;
      exDate: string | null;
      issues: string[];
    }> = [];

    for (const d of rows) {
      const trades = d.asset_id ? (tradesByAsset.get(d.asset_id) ?? []) : [];
      const { issues } = auditDividendRecord(d, trades, today);
      if (issues.length > 0) {
        findings.push({
          id: d.id,
          assetName: d.asset_name,
          exDate: d.ex_date ?? null,
          issues,
        });
      }
    }

    const duplicates = findDuplicateGroups(rows).map((g) => ({
      assetName: g[0]!.asset_name,
      exDate: g[0]!.ex_date ?? g[0]!.paid_at,
      count: g.length,
    }));

    return {
      reviewed: rows.length,
      findings,
      duplicates,
      auditedAt: new Date().toISOString(),
    };
  });
