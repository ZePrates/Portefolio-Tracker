import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Resumo das 9h (agendado na Vercel às 8h e 9h UTC, dias úteis, com o GitHub Actions de reserva):
 * envia uma notificação push a cada utilizador com dispositivos subscritos.
 * Só envia entre as 9h e as 12h de Lisboa e uma vez por dia (notification_log).
 * Protegida pelo segredo de cron (Authorization: Bearer …).
 */
async function handleMorningDigest(request: Request): Promise<Response> {
  const denied = await authenticateCronRequest(request);
  if (denied) return denied;

  const { lisbonClock, shouldSendDigest, digestNotification, digestSummaryLine } =
    await import("@/lib/morning-digest");
  const clock = lisbonClock(new Date());
  const gate = shouldSendDigest(clock);
  if (!gate.send) return Response.json({ skipped: gate.reason, today: clock.date });

  const { vapidConfig, sendPushToUser } = await import("@/lib/push.server");
  const vapid = vapidConfig();
  if (!vapid) {
    return Response.json(
      { error: "Faltam VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY na Vercel." },
      { status: 500 },
    );
  }
  const { getExternalAdminClient } = await import("@/integrations/supabase/admin-external.server");
  const admin = getExternalAdminClient();
  if (!admin) {
    return Response.json(
      { error: "Sem acesso à base de dados externa (URL ou chave em falta)." },
      { status: 500 },
    );
  }
  const db = admin as unknown as import("@/lib/prices.server").PricesDb;
  const { loadMorningDigest } = await import("@/lib/morning-digest.server");

  const { data: subs, error } = await db.from("push_subscriptions").select("user_id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const userIds = [...new Set((subs ?? []).map((s) => s.user_id))];

  const results: Array<Record<string, unknown>> = [];
  let failures = 0;
  for (const userId of userIds) {
    try {
      const { data: done } = await db
        .from("notification_log")
        .select("sent_on")
        .eq("user_id", userId)
        .eq("kind", "morning_digest")
        .eq("sent_on", clock.date)
        .maybeSingle();
      if (done) {
        results.push({ alreadySent: true });
        continue;
      }
      // Reserva o dia antes de enviar: dois agendamentos em simultâneo não duplicam.
      const { error: logErr } = await db.from("notification_log").insert({
        user_id: userId,
        kind: "morning_digest",
        sent_on: clock.date,
      });
      if (logErr) {
        results.push({ alreadySent: true });
        continue;
      }
      const digest = await loadMorningDigest(db, userId, clock.date);
      const sent = await sendPushToUser(db, userId, digestNotification(digest), vapid);
      await db
        .from("notification_log")
        .update({ summary: { line: digestSummaryLine(digest), ...sent } })
        .eq("user_id", userId)
        .eq("kind", "morning_digest")
        .eq("sent_on", clock.date);
      if (sent.failed > 0 && sent.sent === 0) failures++;
      results.push({ ...sent });
    } catch (e) {
      failures++;
      console.error("[morning-digest]", e instanceof Error ? e.message : e);
      results.push({ error: "falhou" });
    }
  }
  return Response.json(
    { today: clock.date, users: userIds.length, results },
    { status: failures > 0 ? 207 : 200 },
  );
}

export const Route = createFileRoute("/api/public/cron/morning-digest")({
  server: {
    handlers: {
      // GET: agendamento da Vercel (envia o CRON_SECRET no cabeçalho Authorization).
      GET: ({ request }) => handleMorningDigest(request),
      // POST: agendamento de reserva no GitHub Actions e execuções manuais.
      POST: ({ request }) => handleMorningDigest(request),
    },
  },
});
