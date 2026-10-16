import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { confirmKey } from "@/lib/month-close";
import { loadMonthClose } from "@/lib/month-close.server";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Estado dos passos do fecho de um mês ("YYYY-MM"). */
export const getMonthClose = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ month: monthSchema }).parse(input))
  .handler(({ data, context }) => loadMonthClose(context.supabase, data.month, todayLisbon()));

/** Confirma (ou reabre) um passo sem extrato: Elementum e Scramble. */
export const setMonthCloseConfirmed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        month: monthSchema,
        step: z.enum(["elementum", "scramble"]),
        confirmed: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const alert_key = confirmKey(data.month, data.step);
    const sb = context.supabase;
    const { error } = data.confirmed
      ? await sb
          .from("dismissed_alerts")
          .upsert([{ user_id: context.userId, alert_key }], { onConflict: "user_id,alert_key" })
      : await sb
          .from("dismissed_alerts")
          .delete()
          .eq("user_id", context.userId)
          .eq("alert_key", alert_key);
    if (error) throw dbError(error);
    return { ok: true };
  });
