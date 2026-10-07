import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { assetCurrentValue, isOpenPosition, type Asset } from "@/lib/portfolio-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { todayLisbon } from "@/lib/dates";

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
 * Garante uma fotografia por dia sem depender do botão "Atualizar preços":
 * chamado ao abrir a app; se já existir a fotografia de hoje não faz nada.
 * Usa os últimos preços guardados (o alerta de preços desatualizados avisa
 * quando estão velhos).
 */
export const ensureDailySnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const today = todayLisbon();
    const { data } = await context.supabase
      .from("portfolio_snapshots")
      .select("id")
      .eq("snapshot_date", today)
      .eq("scope", "total")
      .limit(1);
    if (data && data.length > 0) return { created: false, date: today };
    await takeSnapshot(context.supabase as unknown as SB, context.userId);
    return { created: true, date: today };
  });
