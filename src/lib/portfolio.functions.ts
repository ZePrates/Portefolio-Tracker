import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  applySale,
  buildOpenLots,
  openLotsAt,
  replayLedger,
  totalCost,
  totalQuantity,
  type LedgerEntry,
} from "@/lib/fifo";
import { currentRateOf, needsHistoricalRate, resolveTradeFx, type TradeFx } from "@/lib/fx";
import { dbError } from "@/lib/errors";
import { stripLedgerFields } from "@/lib/asset-class";
import { currencyCode, isinCode, isoDate, tradeDate } from "@/lib/validation";

type AssetUpdate = Database["public"]["Tables"]["assets"]["Update"];
type AssetRow = Database["public"]["Tables"]["assets"]["Row"];
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayLisbon } from "@/lib/dates";
type SupabaseLike = SupabaseClient<Database>;

const assetClassSchema = z.enum([
  "etf",
  "reit",
  "acao_dividendo",
  "acao_crescimento",
  "metal",
  "p2p",
]);

const assetInputSchema = z.object({
  class: assetClassSchema,
  name: z.string().trim().min(1, "Nome é obrigatório").max(200),
  ticker: z.string().trim().max(32).nullable().default(null),
  isin: isinCode.nullable().default(null),
  quantity: z.number().min(0).default(0),
  average_price: z.number().min(0).default(0),
  current_price: z.number().min(0).default(0),
  invested_amount: z.number().min(0).default(0),
  current_value: z.number().min(0).default(0),
  currency: currencyCode.default("EUR"),
  metal_type: z.string().nullable().default(null),
  p2p_group: z.string().nullable().default(null),
  annual_yield: z.number().min(0).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
  native_currency: currencyCode.default("EUR"),
  purchase_price_native: z.number().min(0).nullable().default(null),
  current_price_native: z.number().min(0).nullable().default(null),
  dividend_frequency: z.string().nullable().default(null),
  /** Retenção na fonte dos dividendos (fração 0..1); null = por omissão do domicílio. */
  withholding_rate: z.number().min(0).lt(1).nullable().default(null),
});

export const listAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assets")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw dbError(error);
    return data;
  });

export const createAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => assetInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("assets")
      .insert({ ...data, user_id: context.userId })
      .select()
      .single();
    if (error) throw dbError(error);
    return row;
  });

export const updateAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), patch: assetInputSchema.partial() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    let patch = Object.fromEntries(
      Object.entries(data.patch).filter(([, v]) => v !== undefined),
    ) as AssetUpdate;
    // Com movimentos no livro, quantidade/custo/realizado vêm SEMPRE do FIFO:
    // o formulário de edição não os pode reescrever (antes reescrevia-os com o
    // preço de compra × câmbio de hoje, divergindo do livro).
    const { count, error: countError } = await context.supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", data.id);
    if (countError) throw dbError(countError);
    const hasLedger = (count ?? 0) > 0;
    if (hasLedger) patch = stripLedgerFields(patch) as AssetUpdate;

    const { data: row, error } = await context.supabase
      .from("assets")
      .update(patch)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw dbError(error);
    if (hasLedger) {
      await recomputeAsset(context.supabase, data.id);
      const { data: fresh } = await context.supabase
        .from("assets")
        .select()
        .eq("id", data.id)
        .single();
      return fresh ?? row;
    }
    return row;
  });

export const deleteAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("assets").delete().eq("id", data.id);
    if (error) throw dbError(error);
    return { ok: true };
  });

export const listDividends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("dividends")
      .select("*")
      .order("paid_at", { ascending: false });
    if (error) throw dbError(error);
    return data;
  });

export const createDividend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        asset_id: z.string().uuid().nullable().default(null),
        asset_name: z.string().trim().min(1).max(200),
        amount: z.number().positive("Valor tem de ser positivo"),
        paid_at: isoDate,
        ex_date: isoDate.nullable().default(null),
        currency: currencyCode.default("EUR"),
        amount_native: z.number().nullable().default(null),
        fx_rate: z.number().positive().default(1),
        tax_amount: z.number().min(0).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const today = todayLisbon();
    const gross = data.amount;
    const { data: row, error } = await context.supabase
      .from("dividends")
      .insert({
        user_id: context.userId,
        asset_id: data.asset_id,
        asset_name: data.asset_name,
        amount: gross,
        gross_amount: gross,
        net_amount: gross - data.tax_amount,
        tax_amount: data.tax_amount,
        paid_at: data.paid_at,
        payment_date: data.paid_at,
        ex_date: data.ex_date ?? data.paid_at,
        currency: data.currency,
        amount_native: data.amount_native ?? gross,
        fx_rate: data.fx_rate,
        fx_date: data.paid_at,
        status: data.paid_at <= today ? "received" : "scheduled",
        source: "manual",
      })
      .select()
      .single();
    if (error) throw dbError(error);
    return row;
  });

export const deleteDividend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("dividends").delete().eq("id", data.id);
    if (error) throw dbError(error);
    return { ok: true };
  });

export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ assetId: z.string().uuid().nullable().default(null) })
      .default({ assetId: null })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("transactions")
      .select("*")
      .order("traded_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (data.assetId) q = q.eq("asset_id", data.assetId);
    const { data: rows, error } = await q;
    if (error) throw dbError(error);
    return rows;
  });

const tradeSchema = z.object({
  assetId: z.string().uuid(),
  quantity: z.number().positive("A quantidade tem de ser positiva."),
  /** Preço por unidade na moeda nativa do ativo. */
  price_native: z.number().min(0),
  /** Comissão na moeda nativa do ativo. */
  fee_native: z.number().min(0).default(0),
  traded_at: tradeDate,
  /** Câmbio do extrato do broker (1 unidade nativa = x EUR). Opcional. */
  fx_rate: z.number().positive().nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
});

type TxRow = Database["public"]["Tables"]["transactions"]["Row"];

function toLedgerEntry(
  t: Pick<TxRow, "id" | "type" | "quantity" | "price" | "fee" | "traded_at" | "created_at">,
): LedgerEntry {
  return {
    id: t.id,
    type: t.type,
    quantity: Number(t.quantity),
    price: Number(t.price),
    fee: Number(t.fee ?? 0),
    traded_at: t.traded_at,
    created_at: t.created_at,
  };
}

/** Carrega o ativo e o livro de movimentos completo. */
async function loadPosition(
  supabase: SupabaseLike,
  assetId: string,
): Promise<{ asset: AssetRow; txs: TxRow[]; entries: LedgerEntry[] }> {
  const [assetRes, txRes] = await Promise.all([
    supabase.from("assets").select("*").eq("id", assetId).single(),
    supabase
      .from("transactions")
      .select("*")
      .eq("asset_id", assetId)
      .order("traded_at", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (assetRes.error || !assetRes.data) throw dbError(assetRes.error, "Ativo não encontrado.");
  if (txRes.error) throw dbError(txRes.error);
  const txs = txRes.data ?? [];
  return { asset: assetRes.data, txs, entries: txs.map(toLedgerEntry) };
}

/**
 * Câmbio de um movimento: taxa do extrato (se indicada) → fecho da data do
 * movimento (Yahoo) → taxa atual só para movimentos de hoje. Ver `lib/fx.ts`.
 */
async function tradeFx(
  asset: AssetRow,
  tradedAt: string,
  manualRate: number | null | undefined,
): Promise<TradeFx> {
  const base = {
    nativeCurrency: asset.native_currency,
    tradedAt,
    today: todayLisbon(),
    manualRate: manualRate ?? null,
    currentRate: currentRateOf(asset),
  };
  let historicalRate: number | null = null;
  if (needsHistoricalRate(base)) {
    const { getRateOnDate } = await import("@/lib/yahoo.server");
    historicalRate = await getRateOnDate(asset.native_currency || "EUR", tradedAt, new Map());
  }
  return resolveTradeFx({ ...base, historicalRate });
}

/**
 * Recalcula toda a posição a partir do livro de movimentos (FIFO),
 * reescrevendo o P/L realizado de cada venda e os agregados do ativo.
 * Única fonte de verdade para `assets.quantity/invested_amount/realized_pl`.
 */
export async function recomputeAsset(supabase: SupabaseLike, assetId: string) {
  const { asset, entries } = await loadPosition(supabase, assetId);
  const replay = replayLedger(entries);

  // Só atualiza as vendas (normalmente poucas); em paralelo, não uma a uma.
  const results = await Promise.all(
    replay.sales
      .filter((s) => s.id)
      .map((s) =>
        supabase
          .from("transactions")
          .update({
            realized_pl: s.realizedPL,
            lot_breakdown: JSON.parse(JSON.stringify(s.breakdown)) as Json,
          })
          .eq("id", s.id!),
      ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw dbError(failed.error);

  const quantity = totalQuantity(replay.lots);
  const cost = totalCost(replay.lots);
  const closed = quantity <= 1e-9;
  const rate = currentRateOf(asset);
  const { error } = await supabase
    .from("assets")
    .update({
      quantity: closed ? 0 : quantity,
      invested_amount: closed ? 0 : cost,
      average_price: closed ? asset.average_price : cost / quantity,
      current_value: closed ? 0 : quantity * Number(asset.current_price ?? 0),
      purchase_price_native:
        !closed && rate && rate > 0 ? cost / quantity / rate : asset.purchase_price_native,
      realized_pl: replay.realizedPL,
      total_fees: replay.fees,
      status: closed ? "closed" : "open",
      // Data da última venda (não a do recálculo).
      closed_at: closed ? (replay.lastSellDate ?? todayLisbon()) : null,
    })
    .eq("id", assetId);
  if (error) throw dbError(error);

  return { quantity: closed ? 0 : quantity, closed, realizedPL: replay.realizedPL, replay };
}

/** Insere um movimento depois de validar o livro resultante; desfaz se o recálculo falhar. */
async function insertTrade(
  supabase: SupabaseLike,
  userId: string,
  type: "buy" | "sell",
  data: z.infer<typeof tradeSchema>,
) {
  const { asset, entries } = await loadPosition(supabase, data.assetId);
  const fx = await tradeFx(asset, data.traded_at, data.fx_rate);
  const price = data.price_native * fx.rate;
  const fee = data.fee_native * fx.rate;

  // Valida ANTES de gravar: lança se a venda exceder o detido nessa data.
  const candidate: LedgerEntry = {
    type,
    quantity: data.quantity,
    price,
    fee,
    traded_at: data.traded_at,
    created_at: new Date().toISOString(),
  };
  const preview = replayLedger([...entries, candidate]);

  const { data: inserted, error: txError } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      asset_id: asset.id,
      type,
      quantity: data.quantity,
      price,
      total: type === "buy" ? data.quantity * price + fee : data.quantity * price - fee,
      traded_at: data.traded_at,
      fee,
      fee_native: data.fee_native,
      native_currency: asset.native_currency || "EUR",
      price_native: data.price_native,
      fx_rate: fx.rate,
      fx_source: fx.source,
      source: "manual",
      notes: data.notes,
    })
    .select("id")
    .single();
  if (txError || !inserted) throw dbError(txError);

  try {
    const res = await recomputeAsset(supabase, asset.id);
    return { res, fx, preview, txId: inserted.id };
  } catch (e) {
    // Compensação: sem transações SQL no cliente, desfaz o movimento inserido.
    await supabase.from("transactions").delete().eq("id", inserted.id);
    throw e;
  }
}

/** Regista uma compra; quantidade e custo médio vêm do recálculo FIFO. */
export const buyAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => tradeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { res, fx } = await insertTrade(context.supabase, context.userId, "buy", data);
    const lots = res.replay.lots;
    return {
      quantity: res.quantity,
      invested: totalCost(lots),
      fxRate: fx.rate,
      fxSource: fx.source,
    };
  });

/** Regista uma venda com custo FIFO (lotes detidos na data da venda) e lucro realizado. */
export const sellAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => tradeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { res, fx, txId } = await insertTrade(context.supabase, context.userId, "sell", data);
    const sale = res.replay.sales.find((s) => s.id === txId);
    return {
      quantity: res.quantity,
      closed: res.closed,
      realizedPL: sale?.realizedPL ?? 0,
      costBasis: sale?.costBasis ?? 0,
      proceeds: sale?.proceeds ?? 0,
      fxRate: fx.rate,
      fxSource: fx.source,
    };
  });

/**
 * Estado completo de uma posição: lotes abertos (FIFO), movimentos,
 * P/L realizado e não realizado.
 */
export const getPosition = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ assetId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { asset, txs, entries } = await loadPosition(context.supabase, data.assetId);
    const lots = buildOpenLots(entries);
    const quantity = totalQuantity(lots);
    const costBasis = totalCost(lots);
    const currentValue = quantity * Number(asset.current_price ?? 0);
    const realized = txs.reduce((s, t) => s + Number(t.realized_pl ?? 0), 0);
    return {
      asset,
      lots,
      transactions: txs,
      quantity,
      costBasis,
      currentValue,
      unrealizedPL: quantity > 0 ? currentValue - costBasis : 0,
      realizedPL: realized,
      totalPL: realized + (quantity > 0 ? currentValue - costBasis : 0),
      fxRate: currentRateOf(asset) ?? 1,
    };
  });

/** Edita um movimento existente (data, quantidade, preço, comissão) e recalcula a posição. */
export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        quantity: z.number().positive("A quantidade tem de ser positiva."),
        price_native: z.number().min(0),
        fee_native: z.number().min(0).default(0),
        traded_at: tradeDate,
        fx_rate: z.number().positive().nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: tx, error: findError } = await context.supabase
      .from("transactions")
      .select("*")
      .eq("id", data.id)
      .single();
    if (findError || !tx) throw dbError(findError, "Movimento não encontrado.");
    if (!tx.asset_id) throw new Error("Movimento sem ativo associado.");

    const { asset, entries } = await loadPosition(context.supabase, tx.asset_id);
    // Mesma data e sem taxa indicada: mantém o câmbio já gravado no movimento.
    const keepRate = data.traded_at === tx.traded_at && data.fx_rate == null && tx.fx_rate > 0;
    const fx: TradeFx = keepRate
      ? {
          rate: Number(tx.fx_rate),
          source: (tx.fx_source as TradeFx["source"] | null) ?? "historical",
        }
      : await tradeFx(asset, data.traded_at, data.fx_rate);
    const price = data.price_native * fx.rate;
    const fee = data.fee_native * fx.rate;

    // Valida o livro resultante ANTES de gravar.
    replayLedger(
      entries.map((e) =>
        e.id === tx.id
          ? { ...e, quantity: data.quantity, price, fee, traded_at: data.traded_at }
          : e,
      ),
    );

    const previous = {
      quantity: tx.quantity,
      price: tx.price,
      price_native: tx.price_native,
      fee: tx.fee,
      fee_native: tx.fee_native,
      fx_rate: tx.fx_rate,
      fx_source: tx.fx_source,
      traded_at: tx.traded_at,
      total: tx.total,
    };
    const { error } = await context.supabase
      .from("transactions")
      .update({
        quantity: data.quantity,
        price,
        price_native: data.price_native,
        fee,
        fee_native: data.fee_native,
        fx_rate: fx.rate,
        fx_source: fx.source,
        traded_at: data.traded_at,
        total: tx.type === "buy" ? data.quantity * price + fee : data.quantity * price - fee,
      })
      .eq("id", data.id);
    if (error) throw dbError(error);

    try {
      const res = await recomputeAsset(context.supabase, tx.asset_id);
      return {
        quantity: res.quantity,
        realizedPL: res.realizedPL,
        fxRate: fx.rate,
        fxSource: fx.source,
      };
    } catch (e) {
      await context.supabase.from("transactions").update(previous).eq("id", data.id);
      throw e;
    }
  });

/** Apaga um movimento (se o livro restante for válido) e recalcula a posição. */
export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: tx, error: findError } = await context.supabase
      .from("transactions")
      .select("id, asset_id")
      .eq("id", data.id)
      .single();
    if (findError || !tx) throw dbError(findError, "Movimento não encontrado.");
    if (!tx.asset_id) throw new Error("Movimento sem ativo associado.");

    // Valida ANTES de apagar: ex.: apagar uma compra de que depende uma venda posterior.
    const { entries } = await loadPosition(context.supabase, tx.asset_id);
    replayLedger(entries.filter((e) => e.id !== tx.id));

    const { error } = await context.supabase.from("transactions").delete().eq("id", data.id);
    if (error) throw dbError(error);

    const res = await recomputeAsset(context.supabase, tx.asset_id);
    return { quantity: res.quantity, realizedPL: res.realizedPL };
  });

/** Simula uma venda (sem gravar) para pré-visualização antes da confirmação. */
export const previewSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        assetId: z.string().uuid(),
        quantity: z.number().positive(),
        price_native: z.number().min(0),
        fee_native: z.number().min(0).default(0),
        /** Data da venda; por omissão hoje. Os lotes são os detidos nessa data. */
        traded_at: tradeDate.nullable().default(null),
        fx_rate: z.number().positive().nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { asset, entries } = await loadPosition(context.supabase, data.assetId);
    const date = data.traded_at ?? todayLisbon();
    const fx = await tradeFx(asset, date, data.fx_rate);
    const lots = openLotsAt(entries, date);
    const available = totalQuantity(lots);
    const result = applySale(
      lots,
      data.quantity,
      data.price_native * fx.rate,
      data.fee_native * fx.rate,
    );
    return {
      available,
      fxRate: fx.rate,
      fxSource: fx.source,
      proceeds: result.proceeds,
      fee: data.fee_native * fx.rate,
      costBasis: result.costBasis,
      realizedPL: result.realizedPL,
      breakdown: result.breakdown,
      remainingQuantity: result.remainingQuantity,
      remainingCost: result.remainingCost,
    };
  });
