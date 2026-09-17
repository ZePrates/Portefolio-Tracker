import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import type { Database } from "@/integrations/supabase/types";
import { applySale, buildOpenLots, totalCost, totalQuantity, type LedgerEntry } from "@/lib/fifo";

type AssetUpdate = Database["public"]["Tables"]["assets"]["Update"];
type AssetRow = Database["public"]["Tables"]["assets"]["Row"];
import type { SupabaseClient } from "@supabase/supabase-js";
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
  name: z.string().min(1, "Nome é obrigatório"),
  ticker: z.string().nullable().default(null),
  isin: z.string().nullable().default(null),
  quantity: z.number().min(0).default(0),
  average_price: z.number().min(0).default(0),
  current_price: z.number().min(0).default(0),
  invested_amount: z.number().min(0).default(0),
  current_value: z.number().min(0).default(0),
  currency: z.string().default("EUR"),
  metal_type: z.string().nullable().default(null),
  p2p_group: z.string().nullable().default(null),
  annual_yield: z.number().min(0).nullable().default(null),
  notes: z.string().nullable().default(null),
  native_currency: z.string().default("EUR"),
  purchase_price_native: z.number().min(0).nullable().default(null),
  current_price_native: z.number().min(0).nullable().default(null),
  dividend_frequency: z.string().nullable().default(null),
});

export const listAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assets")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
    return row;
  });

export const updateAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), patch: assetInputSchema.partial() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch = Object.fromEntries(
      Object.entries(data.patch).filter(([, v]) => v !== undefined),
    ) as AssetUpdate;
    const { data: row, error } = await context.supabase
      .from("assets")
      .update(patch)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("assets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listDividends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("dividends")
      .select("*")
      .order("paid_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const createDividend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        asset_id: z.string().uuid().nullable().default(null),
        asset_name: z.string().min(1),
        amount: z.number().positive("Valor tem de ser positivo"),
        paid_at: z.string().min(1),
        ex_date: z.string().nullable().default(null),
        currency: z.string().default("EUR"),
        amount_native: z.number().nullable().default(null),
        fx_rate: z.number().positive().default(1),
        tax_amount: z.number().min(0).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const today = new Date().toISOString().slice(0, 10);
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
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteDividend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("dividends").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
    return rows;
  });

const tradeSchema = z.object({
  assetId: z.string().uuid(),
  quantity: z.number().positive("A quantidade tem de ser positiva."),
  /** Preço por unidade na moeda nativa do ativo. */
  price_native: z.number().min(0),
  /** Comissão na moeda nativa do ativo. */
  fee_native: z.number().min(0).default(0),
  traded_at: z.string().min(1),
  notes: z.string().nullable().default(null),
});

/** Carrega o ativo + livro de movimentos e devolve os lotes FIFO abertos. */
async function loadPosition(
  supabase: SupabaseLike,
  assetId: string,
): Promise<{ asset: AssetRow; entries: LedgerEntry[]; lots: ReturnType<typeof buildOpenLots> }> {
  const { data: asset, error } = await supabase
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .single();
  if (error || !asset) throw new Error(error?.message ?? "Ativo não encontrado.");
  const { data: txs, error: txError } = await supabase
    .from("transactions")
    .select("*")
    .eq("asset_id", assetId);
  if (txError) throw new Error(txError.message);
  const entries: LedgerEntry[] = (txs ?? []).map((t) => ({
    id: t.id,

    type: t.type,
    quantity: Number(t.quantity),
    price: Number(t.price),
    fee: Number(t.fee ?? 0),
    traded_at: t.traded_at,
    created_at: t.created_at,
  }));
  return { asset: asset as AssetRow, entries, lots: buildOpenLots(entries) };
}

function fxRateOf(asset: AssetRow): number {
  const nativeCurrency = asset.native_currency || "EUR";
  if (nativeCurrency === "EUR") return 1;
  if (asset.current_price_native && asset.current_price_native > 0 && asset.current_price > 0) {
    return asset.current_price / asset.current_price_native;
  }
  if (asset.purchase_price_native && asset.purchase_price_native > 0 && asset.average_price > 0) {
    return asset.average_price / asset.purchase_price_native;
  }
  return 1;
}

/** Regista uma compra adicional, atualizando quantidade e custo médio. */
export const buyAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => tradeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { asset, lots } = await loadPosition(context.supabase, data.assetId);
    const rate = fxRateOf(asset);
    const price = data.price_native * rate;
    const fee = data.fee_native * rate;

    const { error: txError } = await context.supabase.from("transactions").insert({
      user_id: context.userId,
      asset_id: asset.id,
      type: "buy",
      quantity: data.quantity,
      price,
      total: data.quantity * price + fee,
      traded_at: data.traded_at,
      fee,
      fee_native: data.fee_native,
      native_currency: asset.native_currency || "EUR",
      price_native: data.price_native,
      fx_rate: rate,
      source: "manual",
      notes: data.notes,
    });
    if (txError) throw new Error(txError.message);

    lots.push({
      originalQuantity: data.quantity,
      quantity: data.quantity,
      unitCost: price + (data.quantity > 0 ? fee / data.quantity : 0),
      traded_at: data.traded_at,
    });
    const quantity = totalQuantity(lots);
    const cost = totalCost(lots);
    const { error } = await context.supabase
      .from("assets")
      .update({
        quantity,
        invested_amount: cost,
        average_price: quantity > 0 ? cost / quantity : 0,
        current_value: quantity * (asset.current_price || 0),
        purchase_price_native:
          rate > 0 && quantity > 0 ? cost / quantity / rate : asset.purchase_price_native,
        total_fees: Number(asset.total_fees ?? 0) + fee,
        status: "open",
        closed_at: null,
      })
      .eq("id", asset.id);
    if (error) throw new Error(error.message);
    return { quantity, invested: cost };
  });

/** Regista uma venda com custo FIFO e lucro realizado. */
export const sellAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => tradeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { asset, lots } = await loadPosition(context.supabase, data.assetId);
    const rate = fxRateOf(asset);
    const price = data.price_native * rate;
    const fee = data.fee_native * rate;

    const result = applySale(lots, data.quantity, price, fee);

    const { error: txError } = await context.supabase.from("transactions").insert({
      user_id: context.userId,
      asset_id: asset.id,
      type: "sell",
      quantity: data.quantity,
      price,
      total: result.proceeds - fee,
      traded_at: data.traded_at,
      fee,
      fee_native: data.fee_native,
      native_currency: asset.native_currency || "EUR",
      price_native: data.price_native,
      fx_rate: rate,
      realized_pl: result.realizedPL,
      lot_breakdown: JSON.parse(JSON.stringify(result.breakdown)),

      source: "manual",
      notes: data.notes,
    });
    if (txError) throw new Error(txError.message);

    const quantity = result.remainingQuantity;
    const closed = quantity <= 1e-9;
    const { error } = await context.supabase
      .from("assets")
      .update({
        quantity: closed ? 0 : quantity,
        invested_amount: closed ? 0 : result.remainingCost,
        average_price: closed ? asset.average_price : result.remainingCost / quantity,
        current_value: closed ? 0 : quantity * (asset.current_price || 0),
        realized_pl: Number(asset.realized_pl ?? 0) + result.realizedPL,
        total_fees: Number(asset.total_fees ?? 0) + fee,
        status: closed ? "closed" : "open",
        closed_at: closed ? new Date().toISOString() : null,
      })
      .eq("id", asset.id);
    if (error) throw new Error(error.message);

    return {
      quantity: closed ? 0 : quantity,
      closed,
      realizedPL: result.realizedPL,
      costBasis: result.costBasis,
      proceeds: result.proceeds,
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
    const { asset, lots } = await loadPosition(context.supabase, data.assetId);
    const { data: txs, error } = await context.supabase
      .from("transactions")
      .select("*")
      .eq("asset_id", data.assetId)
      .order("traded_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const quantity = totalQuantity(lots);
    const costBasis = totalCost(lots);
    const currentValue = quantity * Number(asset.current_price ?? 0);
    const realized = (txs ?? []).reduce((s, t) => s + Number(t.realized_pl ?? 0), 0);
    return {
      asset,
      lots,
      transactions: txs ?? [],
      quantity,
      costBasis,
      currentValue,
      unrealizedPL: quantity > 0 ? currentValue - costBasis : 0,
      realizedPL: realized,
      totalPL: realized + (quantity > 0 ? currentValue - costBasis : 0),
      fxRate: fxRateOf(asset),
    };
  });

/**
 * Recalcula toda a posição a partir do livro de movimentos (FIFO),
 * reescrevendo o P/L realizado de cada venda e os agregados do ativo.
 */
async function recomputeAsset(supabase: SupabaseLike, assetId: string) {
  const { data: asset, error } = await supabase
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .single();
  if (error || !asset) throw new Error(error?.message ?? "Ativo não encontrado.");

  const { data: txs, error: txError } = await supabase
    .from("transactions")
    .select("*")
    .eq("asset_id", assetId)
    .order("traded_at", { ascending: true })
    .order("created_at", { ascending: true });
  if (txError) throw new Error(txError.message);

  let lots: ReturnType<typeof buildOpenLots> = [];
  let realizedTotal = 0;
  let feeTotal = 0;
  const updates: { id: string; realized_pl: number; breakdown: unknown }[] = [];

  for (const t of txs ?? []) {
    const qty = Number(t.quantity) || 0;
    const price = Number(t.price) || 0;
    const fee = Number(t.fee ?? 0) || 0;
    feeTotal += fee;
    if (t.type === "buy") {
      lots.push({
        id: t.id,
        originalQuantity: qty,
        quantity: qty,
        unitCost: price + (qty > 0 ? fee / qty : 0),
        traded_at: t.traded_at,
      });
    } else if (t.type === "sell") {
      const res = applySale(lots, qty, price, fee);
      lots = res.remaining;
      realizedTotal += res.realizedPL;
      updates.push({
        id: t.id,
        realized_pl: res.realizedPL,
        breakdown: JSON.parse(JSON.stringify(res.breakdown)),
      });
    }
  }

  for (const u of updates) {
    const { error: uErr } = await supabase
      .from("transactions")
      .update({
        realized_pl: u.realized_pl,
        lot_breakdown: u.breakdown as never,
      })
      .eq("id", u.id);
    if (uErr) throw new Error(uErr.message);
  }

  const quantity = totalQuantity(lots);
  const cost = totalCost(lots);
  const closed = quantity <= 1e-9;
  const rate = fxRateOf(asset as AssetRow);
  const { error: aErr } = await supabase
    .from("assets")
    .update({
      quantity: closed ? 0 : quantity,
      invested_amount: closed ? 0 : cost,
      average_price: closed ? asset.average_price : cost / quantity,
      current_value: closed ? 0 : quantity * Number(asset.current_price ?? 0),
      purchase_price_native:
        !closed && rate > 0 ? cost / quantity / rate : asset.purchase_price_native,
      realized_pl: realizedTotal,
      total_fees: feeTotal,
      status: closed ? "closed" : "open",
      closed_at: closed ? new Date().toISOString() : null,
    })
    .eq("id", assetId);
  if (aErr) throw new Error(aErr.message);

  return { quantity: closed ? 0 : quantity, realizedPL: realizedTotal };
}

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
        traded_at: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: tx, error: findError } = await context.supabase
      .from("transactions")
      .select("*")
      .eq("id", data.id)
      .single();
    if (findError || !tx) throw new Error(findError?.message ?? "Movimento não encontrado.");
    if (!tx.asset_id) throw new Error("Movimento sem ativo associado.");

    const { asset } = await loadPosition(context.supabase, tx.asset_id);
    const rate = fxRateOf(asset);
    const price = data.price_native * rate;
    const fee = data.fee_native * rate;

    const { error } = await context.supabase
      .from("transactions")
      .update({
        quantity: data.quantity,
        price,
        price_native: data.price_native,
        fee,
        fee_native: data.fee_native,
        fx_rate: rate,
        traded_at: data.traded_at,
        total: tx.type === "buy" ? data.quantity * price + fee : data.quantity * price - fee,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    return await recomputeAsset(context.supabase, tx.asset_id);
  });

/** Apaga um movimento e recalcula a posição a partir do livro restante. */
export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: tx, error: findError } = await context.supabase
      .from("transactions")
      .select("id, asset_id")
      .eq("id", data.id)
      .single();
    if (findError || !tx) throw new Error(findError?.message ?? "Movimento não encontrado.");
    if (!tx.asset_id) throw new Error("Movimento sem ativo associado.");

    const { error } = await context.supabase.from("transactions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    return await recomputeAsset(context.supabase, tx.asset_id);
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { asset, lots } = await loadPosition(context.supabase, data.assetId);
    const rate = fxRateOf(asset);
    const available = totalQuantity(lots);
    const result = applySale(lots, data.quantity, data.price_native * rate, data.fee_native * rate);
    return {
      available,
      fxRate: rate,
      proceeds: result.proceeds,
      fee: data.fee_native * rate,
      costBasis: result.costBasis,
      realizedPL: result.realizedPL,
      breakdown: result.breakdown,
      remainingQuantity: result.remainingQuantity,
      remainingCost: result.remainingCost,
    };
  });
