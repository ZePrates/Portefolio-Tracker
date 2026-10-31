import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { dbError } from "@/lib/errors";

const subscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(8).max(100),
  }),
  userAgent: z.string().max(300).nullish(),
});

/** Chave pública VAPID e dispositivos subscritos deste utilizador. */
export const getPushStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { vapidPublicKey } = await import("@/lib/push.server");
    const { data, error } = await context.supabase
      .from("push_subscriptions")
      .select("endpoint, last_success_at, created_at");
    if (error) throw dbError(error);
    return { publicKey: vapidPublicKey(), devices: data ?? [] };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => subscriptionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("push_subscriptions").upsert(
      [
        {
          user_id: context.userId,
          endpoint: data.endpoint,
          p256dh: data.keys.p256dh,
          auth: data.keys.auth,
          user_agent: data.userAgent ?? null,
        },
      ],
      { onConflict: "endpoint" },
    );
    if (error) throw dbError(error);
    return { ok: true };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ endpoint: z.string().max(1000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint);
    if (error) throw dbError(error);
    return { ok: true };
  });

/**
 * Envia já uma notificação para os dispositivos deste utilizador:
 * "test" (mensagem curta) ou "digest" (o resumo de hoje, sem contar para o envio das 9h).
 */
export const sendPushNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ kind: z.enum(["test", "digest"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { vapidConfig, sendPushToUser } = await import("@/lib/push.server");
    const vapid = vapidConfig();
    if (!vapid) {
      throw new Error("As notificações não estão configuradas: faltam as chaves VAPID na Vercel.");
    }
    const sb = context.supabase;
    let payload: { title: string; body: string; tag?: string; url?: string };
    if (data.kind === "test") {
      payload = {
        title: "Portefólio Tracker",
        body: "Notificações ativas. O resumo chega nos dias úteis às 9h.",
        tag: "test",
        url: "/",
      };
    } else {
      const { todayLisbon } = await import("@/lib/dates");
      const { loadMorningDigest } = await import("@/lib/morning-digest.server");
      const { digestNotification } = await import("@/lib/morning-digest");
      payload = digestNotification(await loadMorningDigest(sb, context.userId, todayLisbon()));
    }
    const result = await sendPushToUser(sb, context.userId, payload, vapid);
    if (result.sent === 0) {
      throw new Error(
        result.removed > 0
          ? "A subscrição deste dispositivo expirou. Ativa as notificações de novo."
          : "Não há dispositivos com notificações ativas.",
      );
    }
    return result;
  });
