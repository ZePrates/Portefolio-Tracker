/**
 * Orquestração da tarefa diária: para cada utilizador com posições abertas,
 * atualiza os preços e guarda a fotografia do dia. Um utilizador que falhe
 * não impede os restantes. As dependências entram por parâmetro para poder
 * ser testada sem rede nem base de dados.
 */

export interface DailySnapshotDeps {
  listUserIds: () => Promise<string[]>;
  refreshPrices: (userId: string) => Promise<{ updated: number; failed: string[] }>;
  takeSnapshot: (userId: string) => Promise<void>;
}

export interface DailySnapshotResult {
  users: number;
  ok: number;
  failed: Array<{ userId: string; error: string }>;
  pricesUpdated: number;
  priceFailures: number;
}

export async function runDailySnapshots(deps: DailySnapshotDeps): Promise<DailySnapshotResult> {
  const ids = [...new Set(await deps.listUserIds())];
  const result: DailySnapshotResult = {
    users: ids.length,
    ok: 0,
    failed: [],
    pricesUpdated: 0,
    priceFailures: 0,
  };
  for (const userId of ids) {
    try {
      // Preços primeiro; se a atualização falhar, a fotografia usa os últimos preços guardados.
      try {
        const r = await deps.refreshPrices(userId);
        result.pricesUpdated += r.updated;
        result.priceFailures += r.failed.length;
      } catch {
        result.priceFailures += 1;
      }
      await deps.takeSnapshot(userId);
      result.ok += 1;
    } catch (e) {
      result.failed.push({ userId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
