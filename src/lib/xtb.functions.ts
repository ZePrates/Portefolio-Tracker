import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import type { Database } from "@/integrations/supabase/external-types";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { replayLedger } from "@/lib/fifo";
import { recomputeAsset } from "@/lib/portfolio.functions";
import {
  convertXtbToEur,
  hasStockTransfers,
  parseXtbRows,
  planXtbImport,
  xtbEventId,
  type XtbImportPlan,
  type XtbParseResult,
} from "@/lib/xtb";

type SB = SupabaseClient<Database>;

/** Extratos já lidos no browser (CSV ou Excel): as operações de caixa de cada conta. */
const filesInput = z.object({
  files: z
    .array(
      z.object({
        name: z.string().max(200),
        /** Moeda da conta: os montantes das operações vêm nesta moeda. */
        currency: z.string().regex(/^[A-Z]{3}$/),
        rows: z
          .array(
            z.object({
              line: z.number().int(),
              id: z.string().max(40),
              type: z.string().max(80),
              date: z.string().nullable(),
              symbol: z.string().max(40),
              comment: z.string().max(300),
              amount: z.number(),
            }),
          )
          .max(20_000),
      }),
    )
    .min(1, "Escolhe pelo menos um extrato.")
    .max(10),
});
type FilesInput = z.infer<typeof filesInput>;

/**
 * Junta os extratos de várias contas num só resultado. As contas que não são
 * em EUR são convertidas ao câmbio de cada dia (o mesmo critério dos
 * movimentos manuais), porque a XTB não mostra quantos euros custaram.
 */
async function parseFiles(files: FilesInput["files"]) {
  const { getRateOnDate } = await import("@/lib/yahoo.server");
  const merged: XtbParseResult = { trades: [], dividends: [], ignored: [], errors: [] };
  const ignored = new Map<string, number>();
  const foreignIds = new Set<string>();
  let transfers = false;
  for (const file of files) {
    let parsed = parseXtbRows(file.rows);
    transfers ||= hasStockTransfers(parsed);
    if (file.currency !== "EUR") {
      const cache = new Map<string, number | null>();
      const dates = [...new Set([...parsed.trades, ...parsed.dividends].map((x) => x.date))].sort();
      const rates = new Map<string, number | null>();
      for (const d of dates) rates.set(d, await getRateOnDate(file.currency, d, cache));
      parsed = convertXtbToEur(parsed, (d) => rates.get(d) ?? null);
      for (const t of parsed.trades) foreignIds.add(t.sourceId);
    }
    merged.trades.push(...parsed.trades);
    merged.dividends.push(...parsed.dividends);
    for (const i of parsed.ignored) ignored.set(i.type, (ignored.get(i.type) ?? 0) + i.count);
    merged.errors.push(
      ...parsed.errors.map((e) => ({ ...e, message: `${file.name}: ${e.message}` })),
    );
  }
  merged.ignored = [...ignored.entries()].map(([type, count]) => ({ type, count }));
  return { parsed: merged, transfers, foreignIds };
}

async function buildPlan(
  sb: SB,
  files: FilesInput["files"],
): Promise<{
  parsed: XtbParseResult;
  plan: XtbImportPlan;
  assetNames: Map<string, string>;
  transfers: boolean;
  foreignIds: Set<string>;
}> {
  const { parsed, transfers, foreignIds } = await parseFiles(files);
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
    transfers,
    foreignIds,
  };
}

/** Pré-visualização do import (não grava nada). */
export const previewXtbImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => filesInput.parse(input))
  .handler(async ({ data, context }) => {
    const { parsed, plan, transfers } = await buildPlan(context.supabase, data.files);
    return { plan, ignored: parsed.ignored, errors: parsed.errors, transfers };
  });

/**
 * Executa o import: concilia movimentos manuais iguais (passam a ter o valor
 * real em EUR do broker), insere os novos, confirma dividendos estimados e
 * recalcula as posições afetadas. Idempotente: cada operação fica marcada com
 * o ID XTB e nunca é importada duas vezes, por isso pode ser repetido.
 */
export const commitXtbImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => filesInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const { parsed, plan, assetNames, foreignIds } = await buildPlan(sb, data.files);
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
        // Conta em EUR: câmbio real do broker; noutra moeda, câmbio do dia.
        fx_source: foreignIds.has(t.sourceId) ? "historical" : "broker",
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
