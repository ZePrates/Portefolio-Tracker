import { useEffect } from "react";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";
import { PrivateModeProvider } from "@/components/private-mode";
import { ConfirmProvider } from "@/components/ui-bits";
import { ensureDailySnapshot } from "@/lib/snapshots.functions";

/** Uma tentativa de fotografia diária por sessão do browser. */
let dailySnapshotRequested = false;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Sessão local (sem ida ao servidor em cada navegação); o token é validado
    // no servidor por cada server function (requireSupabaseAuth).
    const { data, error } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (error || !user) throw redirect({ to: "/auth" });
    return { user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const snapshotFn = useServerFn(ensureDailySnapshot);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (dailySnapshotRequested) return;
    dailySnapshotRequested = true;
    snapshotFn()
      .then((r) => {
        if (r.created) void queryClient.invalidateQueries({ queryKey: ["portfolio-snapshots"] });
      })
      .catch(() => {
        // Best-effort: a fotografia diária nunca bloqueia a app.
      });
  }, [snapshotFn, queryClient]);

  return (
    <PrivateModeProvider>
      <ConfirmProvider>
        <a
          href="#conteudo"
          className="sr-only z-[70] rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Saltar para o conteúdo
        </a>
        <div className="min-h-screen bg-background">
          <AppSidebar />
          <main id="conteudo" tabIndex={-1} className="outline-none lg:pl-60">
            <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
              <Outlet />
            </div>
          </main>
        </div>
      </ConfirmProvider>
    </PrivateModeProvider>
  );
}
