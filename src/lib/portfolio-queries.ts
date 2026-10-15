import type { QueryClient } from "@tanstack/react-query";

/**
 * Todas as queries que dependem de posições, movimentos, cotações ou
 * dividendos. Depois de qualquer alteração à carteira invalida-se esta lista
 * inteira, para nenhum ecrã ficar com números de antes da alteração.
 * Só as queries ativas voltam a ser lidas; as restantes ficam marcadas como
 * desatualizadas e são lidas quando o ecrã delas abrir.
 */
export const PORTFOLIO_QUERY_KEYS = [
  "assets",
  "transactions",
  "dividends",
  "portfolio-snapshots",
  "position",
  "expenses",
  "fire",
  "allocation",
  "exposure",
  "asset-exposure",
  "data-quality",
  "dividend-calendar",
  "scramble",
  "tax",
  "month-close",
] as const;

export async function invalidatePortfolio(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    PORTFOLIO_QUERY_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  );
}
