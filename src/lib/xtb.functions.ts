import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import type { Database } from "@/integrations/supabase/types";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { replayLedger } from "@/lib/fifo";
import { recomputeAsset } from "@/lib/portfolio.functions";
import {
  parseXtbCashOperations,
  planXtbImport,
  xtbEventId,
  type XtbImportPlan,
  type XtbParseResult,
} from "@/lib/xtb";

type SB = SupabaseClient<Database>;

const csvInput = z.object({
  /** Conteúdo do CSV "Cash Operations" exportado da XTB. */
  csv: z
    .string()
    .min(1, "Ficheiro vazio.")
    .max(5_000_000, "Ficheiro demasiado grande (máx. 5 MB)."),
});

async function buildPlan(
  sb: SB,
  csv: string,
): Promise<{ parsed: XtbParseResult; plan: XtbImportPlan; assetNames: Map<string, string> }> {
  const parsed = parseXtbCashOperations(csv);
  const [assetsRes, txRes, divRes] = await Promise.all([
    sb.from("assets").select("id, name, ticker, price_source"),
    sb
      .from("transactions")
      .select(
        "id, asset_id, type, quantity, price, fee, traded_at, created_at, source, source_event_id",
      ),
    sb
      .from("dividends")
      .select("id, asset_id, source, source_event_id, ex_date, payment_date_estimated"),
  ]);
  for (const r of [assetsRes, txRes, divRes]) if (r.error) throw dbError(r.error);

  const plan = planXtbImport({
    parsed,
    assets: assetsRes.data ?? [],
    existingTransactions: (txRes.data ?? []).map((t) => ({
      ...t,
      quantity: Number(t.quantity),
      price: Number(t.price),
      fee: Number(t.fee ?? 0),
    })),
    existingDividends: divRes.data ?? [],
    validateLedger: (entries) => {
      replayLedger(entries);
    },
  });
  return {
    parsed,
    plan,
    assetNames: new Map((assetsRes.data ?? []).map((a) => [a.id, a.name])),
  };
}

/** Pré-visualização do import (não grava nada). */
export const previewXtbImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => csvInput.parse(input))
  .handler(async ({ data, context }) => {
    const { parsed, plan } = await buildPlan(context.supabase, data.csv);
    return { plan, ignored: parsed.ignored, errors: parsed.errors };
  });

/**
 * Executa o import: concilia movimentos manuais iguais (passam a ter o valor
 * real em EUR do broker), insere os novos, confirma dividendos estimados e
 * recalcula as posições afetadas. Idempotente: cada operação fica marcada com
 * o ID XTB e nunca é importada duas vezes, por isso pode ser repetido.
 */
export const commitXtbImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => csvInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const { parsed, plan, assetNames } = await buildPlan(sb, data.csv);
    if (parsed.errors.length > 0 && parsed.trades.length + parsed.dividends.length === 0) {
      throw new Error(parsed.errors[0]!.message);
    }

    const { data: currencies } = await sb.from("assets").select("id, native_currency");
    const currencyOf = new Map((currencies ?? []).map((a) => [a.id, a.native_currency]));
    const affected = new Set<string>();

    for (const p of plan.trades) {
      if (p.action !== "reconcile" && p.action !== "insert") continue;
      const t = p.trade;
      const values = {
        quantity: t.quantity,
        price: t.priceEur,
        price_native: t.priceNative,
        fee: 0,
        fee_native: 0,
        fx_rate: t.fxRate,
        fx_source: "broker",
        total: t.amountEur,
        traded_at: t.date,
        source: "xtb",
        source_event_id: xtbEventId(t.sourceId),
      };
      const res =
        p.action === "reconcile"
          ? await sb.from("transactions").update(values).eq("id", p.reconcileTxId!)
          : await sb.from("transactions").insert({
              ...values,
              user_id: userId,
              asset_id: p.assetId!,
              type: t.kind,
              native_currency: currencyOf.get(p.assetId!) ?? "EUR",
            });
      if (res.error) throw dbError(res.error);
      affected.add(p.assetId!);
    }

    for (const assetId of affected) await recomputeAsset(sb, assetId);

    const today = todayLisbon();
    for (const p of plan.dividends) {
      if (p.action !== "confirm" && p.action !== "insert") continue;
      const d = p.dividend;
      const values = {
        amount: d.grossEur,
        gross_amount: d.grossEur,
        tax_amount: d.taxEur,
        net_amount: d.netEur,
        paid_at: d.date,
        payment_date: d.date,
        payment_date_estimated: false,
        status: d.date <= today ? "received" : "scheduled",
        source: "xtb",
        source_event_id: xtbEventId(d.sourceId),
      };
      const res =
        p.action === "confirm"
          ? await sb.from("dividends").update(values).eq("id", p.confirmDividendId!)
          : await sb.from("dividends").insert({
              ...values,
              user_id: userId,
              asset_id: p.assetId,
              asset_name: assetNames.get(p.assetId!) ?? d.symbol,
              // Valores do extrato já em EUR.
              currency: "EUR",
              fx_rate: 1,
              per_share_native: d.perShareNative,
            });
      if (res.error) throw dbError(res.error);
    }

    return {
      summary: plan.summary,
      unmatchedSymbols: plan.unmatchedSymbols,
      blocked: plan.trades
        .filter((t) => t.action === "blocked")
        .map((t) => ({ symbol: t.trade.symbol, date: t.trade.date, reason: t.reason })),
      recomputedAssets: affected.size,
      errors: parsed.errors,
      importedAt: new Date().toISOString(),
    };
  });
