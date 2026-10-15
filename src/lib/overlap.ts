/**
 * Sobreposição entre ETFs — lógica pura.
 * Sobreposição(A, B) = Σ min(peso em A, peso em B) sobre as empresas comuns:
 * a fração de A que também está em B (e vice-versa) nas holdings conhecidas.
 */

import { equityHolding } from "@/lib/etf-sheet";
import { holdingIndex } from "@/lib/holding-identity";

export interface EtfHoldings {
  assetId: string;
  name: string;
  holdings: Array<{ name: string; isin?: string | null; symbol?: string | null; weight: number }>;
}

export interface OverlapPair {
  a: string;
  b: string;
  aName: string;
  bName: string;
  /** Sobreposição em fração (0..1). */
  overlap: number;
  commonCount: number;
  /** Maiores contributos para a sobreposição. */
  top: Array<{ name: string; weight: number }>;
}

function weightsOf(etf: EtfHoldings): EtfHoldings["holdings"] {
  const rows = new Map<EtfHoldings["holdings"][number], EtfHoldings["holdings"][number]>();
  const find = holdingIndex(etf.holdings);
  for (const h of etf.holdings) {
    if (!Number.isFinite(h.weight) || h.weight <= 0) continue;
    const representative = find(h) ?? h;
    const prior = rows.get(representative);
    if (prior) prior.weight += h.weight;
    else rows.set(representative, { ...h });
  }
  return [...rows.values()];
}

export function etfOverlap(etfs: EtfHoldings[], topN = 5): OverlapPair[] {
  const maps = etfs.map((e) => ({ etf: e, w: weightsOf(e) })).filter((x) => x.w.length > 0);
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < maps.length; i++) {
    for (let j = i + 1; j < maps.length; j++) {
      const A = maps[i];
      const B = maps[j];
      if (!A || !B) continue;
      const find = holdingIndex(B.w);
      const used = new Set<EtfHoldings["holdings"][number]>();
      const shared: Array<{ name: string; weight: number }> = [];
      for (const va of A.w) {
        const vb = find(va);
        if (vb && !used.has(vb)) {
          used.add(vb);
          shared.push({ name: va.name, weight: Math.min(va.weight, vb.weight) });
        }
      }
      shared.sort((x, y) => y.weight - x.weight);
      pairs.push({
        a: A.etf.assetId,
        b: B.etf.assetId,
        aName: A.etf.name,
        bName: B.etf.name,
        overlap: shared.reduce((s, x) => s + x.weight, 0),
        commonCount: shared.length,
        top: shared.slice(0, topN),
      });
    }
  }
  return pairs.sort((x, y) => y.overlap - x.overlap);
}

/* ------------------------------------------------------------------ */
/* Sobreposição na carteira (página Risco)                             */
/* ------------------------------------------------------------------ */

/** A partir daqui dois ETFs são quase o mesmo investimento. */
export const OVERLAP_HIGH = 0.5;
/** A partir daqui a sobreposição já pesa na diversificação. */
export const OVERLAP_MEDIUM = 0.25;

export type OverlapLevel = "high" | "medium" | "low";

export function overlapLevel(overlap: number): OverlapLevel {
  if (overlap >= OVERLAP_HIGH) return "high";
  if (overlap >= OVERLAP_MEDIUM) return "medium";
  return "low";
}

export interface PortfolioOverlapPair extends OverlapPair {
  level: OverlapLevel;
  /** Valor das duas posições na carteira (EUR). */
  aValue: number;
  bValue: number;
}

export interface PortfolioOverlap {
  pairs: PortfolioOverlapPair[];
  /** ETFs comparados (composição completa). */
  compared: number;
  /** ETFs deixados de fora por terem composição parcial ou em falta. */
  skipped: string[];
}

/**
 * Sobreposição entre todos os ETFs da carteira com composição completa.
 * Só conta ações (sem liquidez nem derivados), como na ficha de cada ETF;
 * os ETFs com listas parciais ficam de fora porque subestimariam o resultado.
 */
export function portfolioOverlap(
  positions: Array<{
    assetId: string;
    name: string;
    class: string;
    value: number;
    holdings: Array<{
      name: string;
      isin?: string | null;
      symbol?: string | null;
      asset_class?: string | null;
      weight: number;
    }>;
  }>,
  complete: ReadonlySet<string>,
): PortfolioOverlap {
  const etfs = positions.filter((p) => p.class === "etf");
  const compared = etfs.filter((p) => complete.has(p.assetId));
  const value = new Map(etfs.map((p) => [p.assetId, p.value]));
  const pairs = etfOverlap(
    compared.map((p) => ({
      assetId: p.assetId,
      name: p.name,
      holdings: p.holdings.filter(equityHolding),
    })),
  ).map((p) => ({
    ...p,
    level: overlapLevel(p.overlap),
    aValue: value.get(p.a) ?? 0,
    bValue: value.get(p.b) ?? 0,
  }));
  return {
    pairs,
    compared: compared.length,
    skipped: etfs.filter((p) => !complete.has(p.assetId)).map((p) => p.name),
  };
}
