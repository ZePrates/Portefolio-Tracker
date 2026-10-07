/** Regras por classe de ativo e ordenação das tabelas — lógica pura. */

import {
  type Asset,
  type AssetClass,
  assetCurrentValue,
  assetInvested,
  assetPL,
} from "@/lib/portfolio-types";

/** Títulos cotados (têm ticker, preço e dividendos via Yahoo). */
export function isSecurityClass(c: AssetClass | string): boolean {
  return c === "etf" || c === "reit" || c === "acao_dividendo" || c === "acao_crescimento";
}

/** Ativos geridos por quantidade × preço (títulos e metais). P2P é valor agregado. */
export function isQuantityClass(c: AssetClass | string): boolean {
  return isSecurityClass(c) || c === "metal";
}

export function paysDividendsClass(c: AssetClass | string): boolean {
  return c === "reit" || c === "acao_dividendo";
}

/**
 * Campos de um ativo que derivam do livro de movimentos (FIFO). Quando o
 * ativo tem movimentos, nunca podem ser escritos diretamente por um formulário.
 */
export const LEDGER_DERIVED_FIELDS = [
  "quantity",
  "average_price",
  "invested_amount",
  "purchase_price_native",
  "realized_pl",
  "total_fees",
  "current_value",
] as const;

/** Remove de um patch os campos derivados do livro. */
export function stripLedgerFields<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Record<string, unknown> = { ...patch };
  for (const f of LEDGER_DERIVED_FIELDS) delete out[f];
  return out as Partial<T>;
}

export type AssetSortKey =
  "name" | "quantity" | "buyPrice" | "currentPrice" | "invested" | "value" | "pl" | "yield";

export function assetSortValue(a: Asset, key: AssetSortKey): string | number {
  switch (key) {
    case "name":
      return a.name.toLowerCase();
    case "quantity":
      return a.quantity || 0;
    case "buyPrice":
      return a.average_price || 0;
    case "currentPrice":
      return a.current_price || 0;
    case "invested":
      return assetInvested(a);
    case "value":
      return assetCurrentValue(a);
    case "pl":
      return assetPL(a).abs;
    case "yield":
      return a.annual_yield ?? -1;
  }
}
