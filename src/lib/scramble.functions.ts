import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import type { Database } from "@/integrations/supabase/types";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import {
  parseScrambleCsv,
  planScrambleImport,
  scrambleSummary,
  type ScrambleCashRow,
  type ScrambleCashType,
  type ScrambleGroup,
  type ScrambleRoundRow,
} from "@/lib/scramble";

type SB = SupabaseClient<Database>;

const SCRAMBLE_NAME = "Scramble";

const csvInput = z.object({
  csv: z
    .string()
    .min(1, "Ficheiro vazio.")
    .max(2_000_000, "Ficheiro demasiado grande (máx. 2 MB)."),
});

/** O ativo P2P da Scramble (o primeiro P2P com "scramble" no nome). */
async function findScrambleAsset(sb: SB) {
  const { data, error } = await sb
    .from("assets")
    .select("id, name, p2p_group, created_at")
    .eq("class", "p2p")
    .ilike("name", "%scramble%")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw dbError(error);
  return data?.[0] ?? null;
}

async function loadMovements(sb: SB, assetId: string) {
  const [cashRes, roundRes] = await Promise.all([
    sb
      .from("p2p_cash_movements")
      .select("occurred_on, seq, type, label, description, amount, balance")
      .eq("asset_id", assetId)
      .order("occurred_on", { ascending: true })
      .order("seq", { ascending: true }),
    sb
      .from("p2p_round_movements")
      .select(
        "occurred_on, seq, round_key, opening_principal, invested, principal_repaid, interest_received, closing_principal",
      )
      .eq("asset_id", assetId)
      .order("occurred_on", { ascending: true })
      .order("seq", { ascending: true }),
  ]);
  if (cashRes.error) throw dbError(cashRes.error);
  if (roundRes.error) throw dbError(roundRes.error);

  const cash: ScrambleCashRow[] = (cashRes.data ?? []).map((r) => ({
    date: r.occurred_on,
    seq: r.seq,
    type: r.type as ScrambleCashType,
    label: r.label,
    description: r.description,
    amount: Number(r.amount),
    balance: r.balance == null ? null : Number(r.balance),
  }));
  const rounds: ScrambleRoundRow[] = (roundRes.data ?? []).map((r) => ({
    date: r.occurred_on,
    seq: r.seq,
    roundKey: r.round_key,
    openingPrincipal: Number(r.opening_principal),
    invested: Number(r.invested),
    principalRepaid: Number(r.principal_repaid),
    interestReceived: Number(r.interest_received),
    closingPrincipal: Number(r.closing_principal),
  }));
  return { cash, rounds };
}

const groupOf = (g: string | null | undefined): ScrambleGroup => (g === "B" ? "B" : "A");

/**
 * Atualiza o ativo a partir dos movimentos: investido = depósitos líquidos,
 * valor atual = saldo total da Scramble (capital em dívida + caixa) e yield =
 * taxa mensal efetiva × 12. Os juros por receber ficam fora do valor atual.
 */
async function syncScrambleAsset(sb: SB, assetId: string, group: ScrambleGroup) {
  const { cash, rounds } = await loadMovements(sb, assetId);
  const s = scrambleSummary({ cash, rounds, group, today: todayLisbon() });
  const hasCash = cash.length > 0;
  const { error } = await sb
    .from("assets")
    .update({
      invested_amount: hasCash ? Math.max(0, s.netDeposits) : s.outstanding,
      current_value: hasCash ? Math.max(0, s.totalValue) : s.outstanding,
      annual_yield: Math.round(s.monthlyRate * 12 * 10000) / 100,
      status: "open",
      closed_at: null,
    })
    .eq("id", assetId);
  if (error) throw dbError(error);
  return s;
}

/** Resumo completo da conta Scramble (null se ainda não houver conta). */
export const getScramble = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const asset = await findScrambleAsset(sb);
    if (!asset) return null;
    const { cash, rounds } = await loadMovements(sb, asset.id);
    const summary = scrambleSummary({
      cash,
      rounds,
      group: groupOf(asset.p2p_group),
      today: todayLisbon(),
    });
    return {
      asset: { id: asset.id, name: asset.name, group: groupOf(asset.p2p_group) },
      summary,
      counts: { cash: cash.length, rounds: rounds.length },
      cash: [...cash].reverse(),
    };
  });

async function countInPeriod(
  sb: SB,
  table: "p2p_cash_movements" | "p2p_round_movements",
  assetId: string | null,
  period: { from: string; to: string },
): Promise<number> {
  if (!assetId) return 0;
  const { count, error } = await sb
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("asset_id", assetId)
    .gte("occurred_on", period.from)
    .lte("occurred_on", period.to);
  if (error) throw dbError(error);
  return count ?? 0;
}

/** Pré-visualização (não grava nada). */
export const previewScrambleImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => csvInput.parse(input))
  .handler(async ({ data, context }) => {
    const parsed = parseScrambleCsv(data.csv);
    if (parsed.errors.length > 0 || !parsed.period) {
      return { plan: null, errors: parsed.errors };
    }
    const asset = await findScrambleAsset(context.supabase);
    const table = parsed.kind === "cash" ? "p2p_cash_movements" : "p2p_round_movements";
    const existing = await countInPeriod(context.supabase, table, asset?.id ?? null, parsed.period);
    return { plan: planScrambleImport(parsed, existing), errors: [] as string[] };
  });

/**
 * Importa um relatório: substitui os movimentos desse tipo dentro do período
 * do ficheiro (idempotente) e atualiza o ativo Scramble, criando-o se faltar.
 */
export const commitScrambleImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => csvInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const parsed = parseScrambleCsv(data.csv);
    if (parsed.errors.length > 0) throw new Error(parsed.errors[0]!);
    if (!parsed.period) throw new Error("O ficheiro não indica o período.");

    let asset = await findScrambleAsset(sb);
    if (!asset) {
      const { data: row, error } = await sb
        .from("assets")
        .insert({
          user_id: userId,
          class: "p2p",
          name: SCRAMBLE_NAME,
          p2p_group: "A",
          currency: "EUR",
          native_currency: "EUR",
          notes: "Conta P2P na Scramble (Estónia). Atualizada pela importação dos relatórios.",
        })
        .select("id, name, p2p_group, created_at")
        .single();
      if (error) throw dbError(error);
      asset = row;
    }

    const { from, to } = parsed.period;
    if (parsed.kind === "cash") {
      const del = await sb
        .from("p2p_cash_movements")
        .delete()
        .eq("asset_id", asset.id)
        .gte("occurred_on", from)
        .lte("occurred_on", to);
      if (del.error) throw dbError(del.error);
      if (parsed.cash.length > 0) {
        const ins = await sb.from("p2p_cash_movements").insert(
          parsed.cash.map((r) => ({
            user_id: userId,
            asset_id: asset.id,
            occurred_on: r.date,
            seq: r.seq,
            type: r.type,
            label: r.label.slice(0, 200),
            description: r.description.slice(0, 500),
            amount: r.amount,
            balance: r.balance,
          })),
        );
        if (ins.error) throw dbError(ins.error);
      }
    } else {
      const del = await sb
        .from("p2p_round_movements")
        .delete()
        .eq("asset_id", asset.id)
        .gte("occurred_on", from)
        .lte("occurred_on", to);
      if (del.error) throw dbError(del.error);
      if (parsed.rounds.length > 0) {
        const ins = await sb.from("p2p_round_movements").insert(
          parsed.rounds.map((r) => ({
            user_id: userId,
            asset_id: asset.id,
            occurred_on: r.date,
            seq: r.seq,
            round_key: r.roundKey,
            opening_principal: r.openingPrincipal,
            invested: r.invested,
            principal_repaid: r.principalRepaid,
            interest_received: r.interestReceived,
            closing_principal: r.closingPrincipal,
          })),
        );
        if (ins.error) throw dbError(ins.error);
      }
    }

    const summary = await syncScrambleAsset(sb, asset.id, groupOf(asset.p2p_group));
    return {
      kind: parsed.kind,
      rows: parsed.kind === "cash" ? parsed.cash.length : parsed.rounds.length,
      totalValue: summary.totalValue,
    };
  });
