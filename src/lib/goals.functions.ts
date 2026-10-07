import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { allocationDrift, contributionPlan } from "@/lib/allocation";
import { allocationByClass, assetPerformance } from "@/lib/dashboard";
import { todayLisbon } from "@/lib/dates";
import { receivedLast12Months, type DividendRecord } from "@/lib/dividends";
import { dbError } from "@/lib/errors";
import { fireProgress } from "@/lib/fire";
import { assetCurrentValue, isOpenPosition, type Asset } from "@/lib/portfolio-types";

const scopeSchema = z.enum(["class", "asset"]);

/* ------------------------------------------------------------------ */
/* Alocação-alvo e rebalanceamento                                     */
/* ------------------------------------------------------------------ */

/** Desvio face aos alvos e sugestão de aporte sem vender. */
export const getAllocation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        scope: scopeSchema.default("class"),
        /** Aporte a repartir (EUR); 0 = só desvio. */
        contribution: z.number().min(0).max(10_000_000).default(0),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const [assetsRes, targetsRes] = await Promise.all([
      context.supabase.from("assets").select("*"),
      context.supabase.from("allocation_targets").select("key, target_pct").eq("scope", data.scope),
    ]);
    if (assetsRes.error) throw dbError(assetsRes.error);
    if (targetsRes.error) throw dbError(targetsRes.error);
    const assets = (assetsRes.data ?? []) as Asset[];
    const slices =
      data.scope === "class"
        ? allocationByClass(assets).map((s) => ({ key: s.class, label: s.label, value: s.value }))
        : assetPerformance(assets).map((a) => ({ key: a.id, label: a.name, value: a.value }));
    const targets = (targetsRes.data ?? []).map((t) => ({
      key: t.key,
      targetPct: Number(t.target_pct),
    }));
    return {
      scope: data.scope,
      drift: allocationDrift(slices, targets),
      contribution: contributionPlan(slices, targets, data.contribution),
    };
  });

/** Substitui os alvos de um âmbito (os que não vierem na lista são removidos). */
export const setAllocationTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        scope: scopeSchema,
        targets: z
          .array(
            z.object({
              key: z.string().trim().min(1).max(64),
              targetPct: z.number().min(0).max(100),
            }),
          )
          .max(200)
          .refine(
            (ts) => ts.reduce((s, t) => s + t.targetPct, 0) <= 100.0001,
            "A soma dos pesos-alvo não pode passar de 100%.",
          )
          .refine((ts) => new Set(ts.map((t) => t.key)).size === ts.length, "Chaves repetidas."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    if (data.targets.length > 0) {
      const { error } = await sb.from("allocation_targets").upsert(
        data.targets.map((t) => ({
          user_id: context.userId,
          scope: data.scope,
          key: t.key,
          target_pct: t.targetPct,
        })),
        { onConflict: "user_id,scope,key" },
      );
      if (error) throw dbError(error);
    }
    let del = sb.from("allocation_targets").delete().eq("scope", data.scope);
    if (data.targets.length > 0) {
      del = del.not("key", "in", `(${data.targets.map((t) => `"${t.key}"`).join(",")})`);
    }
    const { error } = await del;
    if (error) throw dbError(error);
    return { ok: true, count: data.targets.length };
  });

/* ------------------------------------------------------------------ */
/* FIRE                                                                */
/* ------------------------------------------------------------------ */

const fireSchema = z.object({
  annualExpenses: z.number().positive().max(10_000_000),
  safeWithdrawalRate: z.number().gt(0).max(10).default(4),
  monthlyContribution: z.number().min(0).max(1_000_000).default(0),
  expectedReturnPct: z.number().gt(-50).lt(50).default(5),
  inflationPct: z.number().gt(-10).lt(30).default(2),
});

/** Parâmetros FIRE e progresso atual (null se ainda não configurado). */
export const getFireProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [settingsRes, assetsRes, divRes] = await Promise.all([
      sb.from("fire_settings").select("*").maybeSingle(),
      sb.from("assets").select("*"),
      sb
        .from("dividends")
        .select(
          "asset_id, asset_name, amount, gross_amount, net_amount, paid_at, payment_date, status",
        ),
    ]);
    for (const r of [settingsRes, assetsRes, divRes]) if (r.error) throw dbError(r.error);
    const row = settingsRes.data;
    if (!row) return { settings: null, progress: null };

    const settings = {
      annualExpenses: Number(row.annual_expenses),
      safeWithdrawalRate: Number(row.safe_withdrawal_rate),
      monthlyContribution: Number(row.monthly_contribution),
      expectedReturnPct: Number(row.expected_return_pct),
      inflationPct: Number(row.inflation_pct),
    };
    const assets = (assetsRes.data ?? []) as Asset[];
    const value = assets.filter(isOpenPosition).reduce((s, a) => s + assetCurrentValue(a), 0);
    const today = todayLisbon();
    const passive = receivedLast12Months((divRes.data ?? []) as DividendRecord[], today, "net");
    return { settings, progress: fireProgress(settings, value, passive, today) };
  });

export const saveFireSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => fireSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("fire_settings").upsert(
      {
        user_id: context.userId,
        annual_expenses: data.annualExpenses,
        safe_withdrawal_rate: data.safeWithdrawalRate,
        monthly_contribution: data.monthlyContribution,
        expected_return_pct: data.expectedReturnPct,
        inflation_pct: data.inflationPct,
      },
      { onConflict: "user_id" },
    );
    if (error) throw dbError(error);
    return { ok: true };
  });
