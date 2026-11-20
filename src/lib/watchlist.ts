/**
 * Watchlist — regras puras (sem I/O), partilhadas pela página Avaliação e pelo
 * resumo das 9h. O preço-alvo está sempre na moeda da cotação.
 */

/** Uma entrada da watchlist, tal como chega ao browser. */
export interface WatchlistEntry {
  id: string;
  /** Símbolo do Yahoo (maiúsculas). */
  symbol: string;
  name: string;
  /** Preço-alvo na moeda da cotação (null = sem alvo). */
  targetPrice: number | null;
  notes: string | null;
  createdAt: string;
}

/**
 * Distância do preço ao preço-alvo, em fração: −0,05 = 5 % abaixo do alvo.
 * null sem alvo ou sem preço válido.
 */
export function targetGap(price: number | null | undefined, target: number | null | undefined) {
  if (price == null || target == null) return null;
  if (!Number.isFinite(price) || !Number.isFinite(target) || price <= 0 || target <= 0) return null;
  return price / target - 1;
}

/** O preço está abaixo do preço-alvo (estritamente). */
export function isBelowTarget(price: number | null | undefined, target: number | null | undefined) {
  const gap = targetGap(price, target);
  return gap != null && gap < 0;
}
