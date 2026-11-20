/**
 * Envio Web Push (VAPID) — só servidor. A chave privada nunca chega ao browser.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/external-types";

type Db = SupabaseClient<Database>;

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidConfig(): VapidConfig | null {
  const env = typeof process !== "undefined" ? process.env : {};
  const publicKey = env["VAPID_PUBLIC_KEY"]?.trim();
  const privateKey = env["VAPID_PRIVATE_KEY"]?.trim();
  const subject = env["VAPID_SUBJECT"]?.trim() || "https://portefolio-tracker.vercel.app";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export function vapidPublicKey(): string | null {
  const key = typeof process !== "undefined" ? process.env["VAPID_PUBLIC_KEY"]?.trim() : "";
  return key ? key : null;
}

export interface SendResult {
  sent: number;
  removed: number;
  failed: number;
}

/** Envia a todas as subscrições de um utilizador; remove as que o serviço de push deu como expiradas. */
export async function sendPushToUser(
  db: Db,
  userId: string,
  payload: PushPayload,
  config: VapidConfig,
): Promise<SendResult> {
  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const webpush = (await import("web-push")).default;
  const result: SendResult = { sent: 0, removed: 0, failed: 0 };
  const body = JSON.stringify(payload);

  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        {
          vapidDetails: config,
          TTL: 6 * 60 * 60,
          urgency: "normal",
          ...(payload.tag
            ? { topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) }
            : {}),
        },
      );
      result.sent++;
      await db
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString() })
        .eq("id", s.id)
        .eq("user_id", userId);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from("push_subscriptions").delete().eq("id", s.id).eq("user_id", userId);
        result.removed++;
      } else {
        console.error(`[push] envio falhou (${status ?? "sem código"})`);
        result.failed++;
      }
    }
  }
  return result;
}
