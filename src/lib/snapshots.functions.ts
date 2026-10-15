import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { assetCurrentValue, isOpenPosition, type Asset } from "@/lib/portfolio-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/external-types";
import { isoDateLisbon, todayLisbon } from "@/lib/dates";
import { planOpenAppSnapshot } from "@/lib/daily-snapshot";

export type SB = { from: SupabaseClient<Database>["from"] };

export interface PortfolioSnapshotRow {
  snapshotDate: string;
  scope: string;
  investedAmount: number;
  marketValue: number | null;
  source: string;
}

/**
 * Guarda uma fotografia (carteira total + cada classe presente) do dia de
 * hoje. Idempotente por dia: chamar duas vezes no mesmo dia atualiza a
 * mesma linha em vez de duplicar (UNIQUE (user_id, snapshot_date, scope)).
 * Best-effort — nunca lança: uma falha ao gravar a fotografia não deve
 * impedir a atualização de preços que a despoletou.
 */
export async function takeSnapshot(supabase: SB, userId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from("assets")
      .select("class, quantity, invested_amount, current_value, status")
      .eq("user_id", userId)
      .neq("status", "closed");
    const assets = (data ?? []) as Pick<
      Asset,
      "class" | "quantity" | "invested_amount" | "current_value" | "status"
    >[];
    const open = assets.filter((a) => isOpenPosition(a as Asset));
    if (open.length === 0) return;

    const today = todayLisbon();
    const byClass = new Map<string, { invested: number; value: number }>();
    let totalInvested = 0;
    let totalValue = 0;
    for (const a of open) {
      const invested = Number(a.invested_amount) || 0;
      const value = assetCurrentValue(a as Asset);
      totalInvested += invested;
      totalValue += value;
      const c = byClass.get(a.class) ?? { invested: 0, value: 0 };
      c.invested += invested;
      c.value += value;
      byClass.set(a.class, c);
    }

    const rows = [
      {
        user_id: userId,
        snapshot_date: today,
        scope: "total",
        invested_amount: totalInvested,
        market_value: totalValue,
        source: "app",
      },
      ...[...byClass.entries()].map(([cls, v]) => ({
        user_id: userId,
        snapshot_date: today,
        scope: `class:${cls}`,
        invested_amount: v.invested,
        market_value: v.value,
        source: "app",
      })),
    ];
    await supabase
      .from("portfolio_snapshots")
      .upsert(rows, { onConflict: "user_id,snapshot_date,scope" });
  } catch {
    // Best-effort: nunca deve impedir a atualização de preços em curso.
  }
}

/** Histórico de fotografias da carteira, para a linha de lucro não realizado nos gráficos de evolução. */
export const listPortfolioSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("portfolio_snapshots")
      .select("snapshot_date, scope, invested_amount, market_value, source")
      .order("snapshot_date", { ascending: true });
    if (error) throw new Error(error.message);
    const rows: PortfolioSnapshotRow[] = (data ?? []).map((r) => ({
      snapshotDate: r.snapshot_date,
      scope: r.scope,
      investedAmount: Number(r.invested_amount) || 0,
      marketValue: r.market_value == null ? null : Number(r.market_value),
      source: r.source,
    }));
    return rows;
  });

/**
 * Garante uma fotografia por dia sem depender do botão "Atualizar cotações":
 * chamado ao abrir a app. Se as cotações não são de hoje, atualiza-as antes
 * e regrava a fotografia do dia (que podia ter ficado com preços antigos).
 * Com cotações de hoje e fotografia já gravada, não faz nada.
 */
export const ensureDailySnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const today = todayLisbon();
    const [{ data: snap }, { data: priced }] = await Promise.all([
      context.supabase
        .from("portfolio_snapshots")
        .select("id")
        .eq("snapshot_date", today)
        .eq("scope", "total")
        .limit(1),
      context.supabase
        .from("assets")
        .select("price_updated_at")
        .neq("status", "closed")
        .neq("class", "p2p"),
    ]);
    const latest = (priced ?? []).reduce<string | null>(
      (acc, a) =>
        a.price_updated_at && (!acc || a.price_updated_at > acc) ? a.price_updated_at : acc,
      null,
    );
    const plan = planOpenAppSnapshot({
      today,
      hasTodaySnapshot: !!snap && snap.length > 0,
      latestPriceDate: latest ? isoDateLisbon(new Date(latest)) : null,
      hasPricedAssets: (priced ?? []).length > 0,
    });

    let pricesUpdated = 0;
    if (plan.refresh) {
      try {
        const { refreshPrices } = await import("@/lib/prices.server");
        const r = await refreshPrices(
          context.supabase as unknown as import("@/lib/prices.server").PricesDb,
          context.userId,
          { class: null, assetId: null },
        );
        pricesUpdated = r.updated;
      } catch {
        // Sem cotações novas, a fotografia usa as últimas guardadas.
      }
    }
    if (plan.snapshot) await takeSnapshot(context.supabase as unknown as SB, context.userId);
    return { created: plan.snapshot, pricesUpdated, date: today };
  });

const historySchema = z.object({
  scope: z.literal("class:etf"),
  rows: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        invested: z.number().min(0).max(1e9),
        value: z.number().min(0).max(1e9),
      }),
    )
    .min(1)
    .max(600),
});

/**
 * Importa histórico mensal (ex.: folha de Excel) como fotografias de um
 * âmbito. Nunca sobrepõe fotografias gravadas pela app nem as do histórico
 * reconstruído (calculadas com os fechos reais); reimportar atualiza as
 * importações anteriores.
 */
export const importSnapshotHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => historySchema.parse(input))
  .handler(async ({ data, context }) => {
    const today = todayLisbon();
    const rows = data.rows.filter((r) => r.date <= today);
    const { data: existing, error: readError } = await context.supabase
      .from("portfolio_snapshots")
      .select("snapshot_date")
      .eq("scope", data.scope)
      .in("source", ["app", "rebuild"])
      .in(
        "snapshot_date",
        rows.map((r) => r.date),
      );
    if (readError) throw new Error(readError.message);
    const fromApp = new Set((existing ?? []).map((r) => r.snapshot_date));
    const toWrite = rows
      .filter((r) => !fromApp.has(r.date))
      .map((r) => ({
        user_id: context.userId,
        snapshot_date: r.date,
        scope: data.scope,
        invested_amount: r.invested,
        market_value: r.value,
        source: "import",
      }));
    if (toWrite.length > 0) {
      const { error } = await context.supabase
        .from("portfolio_snapshots")
        .upsert(toWrite, { onConflict: "user_id,snapshot_date,scope" });
      if (error) throw new Error(error.message);
    }
    return { imported: toWrite.length, skipped: rows.length - toWrite.length };
  });
