/**
 * Orquestração da tarefa diária: para cada utilizador com posições abertas,
 * atualiza os preços e guarda a fotografia do dia. Um utilizador que falhe
 * não impede os restantes. As dependências entram por parâmetro para poder
 * ser testada sem rede nem base de dados.
 */

import { todayLisbon } from "@/lib/dates";

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

/**
 * Problema com a chave de EXTERNAL_SUPABASE_SERVICE_KEY, ou null se serve.
 * A chave publicável (sb_publishable_) está sujeita ao RLS: as leituras vêm
 * vazias e a tarefa acabaria "com sucesso" sem fazer nada.
 */
/** Horas de atraso aceites: uma execução até às 06:00 ainda pertence ao dia anterior. */
export const CRON_LATE_HOURS = 6;

/**
 * Data da fotografia da tarefa diária. O agendamento é às 21:30 UTC, mas o
 * GitHub atrasa-o com frequência para depois da meia-noite (ex.: 01:10), e a
 * fotografia de 26/10 ficava gravada como 27/10 e o dia 26 em falta.
 * A data é a de Lisboa CRON_LATE_HOURS horas antes da execução.
 */
export function cronSnapshotDate(now: Date = new Date()): string {
  return todayLisbon(new Date(now.getTime() - CRON_LATE_HOURS * 3_600_000));
}

export function serviceKeyProblem(key: string | undefined): string | null {
  if (!key) return "EXTERNAL_SUPABASE_SERVICE_KEY em falta: sem acesso à base de dados.";
  if (key.startsWith("sb_publishable_")) {
    return "EXTERNAL_SUPABASE_SERVICE_KEY tem a chave publicável (sb_publishable_): é precisa a chave secreta (sb_secret_).";
  }
  return null;
}

/**
 * Código HTTP da tarefa: 500 se não encontrou nenhum utilizador (chave sem
 * acesso ou base vazia), 207 se algum falhou, 200 se correu tudo. Assim uma
 * execução que não faz nada aparece como falhada no histórico do GitHub Actions.
 */
export function dailySnapshotStatus(result: DailySnapshotResult): number {
  if (result.users === 0) return 500;
  return result.failed.length > 0 ? 207 : 200;
}

export interface OpenAppSnapshotPlan {
  /** Atualizar as cotações antes de gravar (as últimas não são de hoje). */
  refresh: boolean;
  /** Gravar (ou regravar) a fotografia de hoje. */
  snapshot: boolean;
}

/**
 * O que fazer ao abrir a app. Se as cotações não são de hoje, atualiza-as
 * primeiro e regrava a fotografia do dia, para não ficar gravado um valor
 * com preços de dias anteriores. Usa a cotação mais recente (e não a mais
 * antiga): um ativo que falhe sempre não faz repetir a atualização.
 */
export function planOpenAppSnapshot(input: {
  today: string;
  hasTodaySnapshot: boolean;
  /** Data (YYYY-MM-DD, Lisboa) da cotação mais recente; null sem cotações. */
  latestPriceDate: string | null;
  /** Há posições abertas com cotação (tudo exceto P2P). */
  hasPricedAssets: boolean;
}): OpenAppSnapshotPlan {
  const refresh =
    input.hasPricedAssets &&
    (input.latestPriceDate === null || input.latestPriceDate < input.today);
  return { refresh, snapshot: refresh || !input.hasTodaySnapshot };
}

export type PriceFreshness = "today" | "old" | "stale" | "none";

/**
 * Frescura das cotações mostrada no Dashboard: de hoje, de dias anteriores
 * ou desatualizadas (a partir de `staleDays` dias).
 */
export function priceFreshness(
  latestPriceDate: string | null,
  today: string,
  staleDays: number,
): { level: PriceFreshness; days: number } {
  if (!latestPriceDate) return { level: "none", days: 0 };
  const days = Math.max(
    0,
    Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latestPriceDate}T00:00:00Z`)) / 86_400_000,
    ),
  );
  if (days === 0) return { level: "today", days };
  return { level: days >= staleDays ? "stale" : "old", days };
}
