/**
 * Sobreposição entre ETFs — lógica pura.
 * Sobreposição(A, B) = Σ min(peso em A, peso em B) sobre as empresas comuns:
 * a fração de A que também está em B (e vice-versa) nas holdings conhecidas.
 */

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
  const rows: EtfHoldings["holdings"] = [];
  for (const h of etf.holdings) {
    if (!Number.isFinite(h.weight) || h.weight <= 0) continue;
    const prior = holdingIndex(rows)(h);
    if (prior) prior.weight += h.weight;
    else rows.push({ ...h });
  }
  return rows;
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
