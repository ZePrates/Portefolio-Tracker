import { supabase } from "@/integrations/supabase/client";
import { managerSyncSummary, type ManagerSyncResult } from "@/lib/exposure-display";

export async function syncManagerHoldings(assetId?: string) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) throw new Error("Inicia sessão para sincronizar os ETFs.");
  const { data, error } = await supabase.functions.invoke<{ results: ManagerSyncResult[] }>("sync-etf-holdings", {
    body: assetId ? { asset_id: assetId } : {},
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
  });
  if (error) throw new Error("Não foi possível sincronizar com as gestoras. Tenta novamente.");
  if (!data || !Array.isArray(data.results)) throw new Error("A gestora devolveu uma resposta inválida.");
  return { results: data.results, ...managerSyncSummary(data.results) };
}

export function syncSummaryText(summary: { updated: number; unsupported: number; failed: number }) {
  return `${summary.updated} ETFs atualizados, ${summary.unsupported} por suportar${summary.failed ? `, ${summary.failed} com erro` : ""}.`;
}