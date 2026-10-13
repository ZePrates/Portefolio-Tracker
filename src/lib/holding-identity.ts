import { companyNameKey } from './exposure-display';
import { isValidIsin } from './identifiers';
export interface HoldingIdentity { name: string; isin?: string | null; symbol?: string | null }
const symbolKey = (s?: string | null) => s?.trim().toUpperCase() || null;
const isinKey = (s?: string | null) => { const value = s?.trim().toUpperCase(); return value && isValidIsin(value) ? value : null; };
/** Use the strongest identifier available on both sides, with weaker fallbacks only when absent. */
export function sameHolding(a: HoldingIdentity, b: HoldingIdentity): boolean {
  const ai = isinKey(a.isin), bi = isinKey(b.isin);
  if (ai && bi) return ai === bi;
  const at = symbolKey(a.symbol), bt = symbolKey(b.symbol);
  if (at && bt) return at === bt;
  const name = companyNameKey(a.name);
  return !!name && name === companyNameKey(b.name);
}
/** Index all aliases; fallback checks prevent merging different securities sharing a ticker/name. */
export function holdingIndex<T extends HoldingIdentity>(rows: T[]) {
  const index = new Map<string, T[]>();
  for (const row of rows) for (const alias of [isinKey(row.isin) && `i:${isinKey(row.isin)}`, symbolKey(row.symbol) && `s:${symbolKey(row.symbol)}`, `n:${companyNameKey(row.name)}`]) {
    if (!alias) continue;
    index.set(alias, [...(index.get(alias) ?? []), row]);
  }
  return (row: HoldingIdentity) => {
    for (const alias of [isinKey(row.isin) && `i:${isinKey(row.isin)}`, symbolKey(row.symbol) && `s:${symbolKey(row.symbol)}`, `n:${companyNameKey(row.name)}`]) {
      if (!alias) continue;
      const found = (index.get(alias) ?? []).find(candidate => sameHolding(row, candidate));
      if (found) return found;
    }
    return undefined;
  };
}
