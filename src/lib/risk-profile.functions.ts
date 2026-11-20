import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { dbError } from "@/lib/errors";
import { sanitizeAnswers, type RiskAnswers } from "@/lib/risk-profile";

export interface InvestorProfile {
  answers: RiskAnswers;
  /** Taxa sem risco anual, em %. */
  riskFreePct: number;
  /** Liquidez fora da carteira (depósitos, certificados), em EUR. */
  outsideCash: number;
  /** Retorno esperado anual da parte de risco, em %; null = usar o histórico. */
  expectedReturnPct: number | null;
  updatedAt: string;
}

export const RISK_FREE_DEFAULT_PCT = 2;

/** Perfil de risco guardado (null se ainda não respondeu). */
export const getInvestorProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InvestorProfile | null> => {
    const { data, error } = await context.supabase
      .from("investor_profiles")
      .select("answers, risk_free_pct, outside_cash, expected_return_pct, updated_at")
      .maybeSingle();
    if (error) throw dbError(error);
    if (!data) return null;
    return {
      answers: sanitizeAnswers(data.answers),
      riskFreePct: Number(data.risk_free_pct),
      outsideCash: Number(data.outside_cash) || 0,
      expectedReturnPct: data.expected_return_pct == null ? null : Number(data.expected_return_pct),
      updatedAt: data.updated_at,
    };
  });

const profileSchema = z.object({
  answers: z.record(z.string(), z.number().int().min(0).max(3)),
  riskFreePct: z.number().min(-5).max(20),
  outsideCash: z.number().min(0).lt(1_000_000_000),
  expectedReturnPct: z.number().gt(-50).lt(50).nullable(),
});

export const saveInvestorProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => profileSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("investor_profiles").upsert(
      {
        user_id: context.userId,
        answers: sanitizeAnswers(data.answers),
        risk_free_pct: data.riskFreePct,
        outside_cash: data.outsideCash,
        expected_return_pct: data.expectedReturnPct,
      },
      { onConflict: "user_id" },
    );
    if (error) throw dbError(error);
    return { ok: true };
  });
