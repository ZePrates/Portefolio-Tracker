import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Tarefa diária (agendada no Lovable): atualiza os preços de cada utilizador
 * com posições abertas e guarda a fotografia do dia, para os gráficos de
 * Desempenho terem o valor real da carteira mesmo nos dias em que a app não
 * é aberta. Protegida pelo segredo de cron (Authorization: Bearer …).
 */
export const Route = createFileRoute("/api/public/cron/daily-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { runDailySnapshots, serviceKeyProblem, dailySnapshotStatus } =
          await import("@/lib/daily-snapshot");
        const keyProblem = serviceKeyProblem(process.env["EXTERNAL_SUPABASE_SERVICE_KEY"]);
        if (keyProblem) return Response.json({ error: keyProblem }, { status: 500 });

        const { getExternalAdminClient } =
          await import("@/integrations/supabase/admin-external.server");
        const admin = getExternalAdminClient();
        if (!admin) {
          return Response.json(
            { error: "Sem acesso à base de dados externa (URL ou chave em falta)." },
            { status: 500 },
          );
        }
        const db = admin as unknown as import("@/lib/prices.server").PricesDb;
        const { refreshPrices } = await import("@/lib/prices.server");
        const { takeSnapshot } = await import("@/lib/snapshots.functions");

        const result = await runDailySnapshots({
          listUserIds: async () => {
            const { data, error } = await db
              .from("assets")
              .select("user_id")
              .neq("status", "closed");
            if (error) throw new Error(error.message);
            return (data ?? []).map((r) => r.user_id);
          },
          refreshPrices: async (userId) => {
            const r = await refreshPrices(db, userId, { class: null, assetId: null });
            return { updated: r.updated, failed: r.failed };
          },
          takeSnapshot: (userId) => takeSnapshot(db, userId),
        });
        return Response.json(result, { status: dailySnapshotStatus(result) });
      },
    },
  },
});
