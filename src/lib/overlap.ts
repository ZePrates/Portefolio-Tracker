/**
 * Sobreposição entre ETFs — lógica pura.
 * Sobreposição(A, B) = Σ min(peso em A, peso em B) sobre as empresas comuns:
 * a fração de A que também está em B (e vice-versa) nas holdings conhecidas.
 */

import { normalizeCompanyKey } from "@/lib/intelligence";

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

function keyOf(h: { name: string; isin?: string | null; symbol?: string | null }): string {
  const isin = h.isin?.trim().toUpperCase();
  if (isin && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return `isin:${isin}`;
  return `name:${normalizeCompanyKey(h.name || h.symbol || "")}`;
}

function weightsOf(etf: EtfHoldings): Map<string, { name: string; weight: number }> {
  const map = new Map<string, { name: string; weight: number }>();
  for (const h of etf.holdings) {
    const w = Number(h.weight) || 0;
    if (w <= 0) continue;
    const k = keyOf(h);
    const cur = map.get(k);
    map.set(k, { name: cur?.name ?? h.name, weight: (cur?.weight ?? 0) + w });
  }
  return map;
}

export function etfOverlap(etfs: EtfHoldings[], topN = 5): OverlapPair[] {
  const maps = etfs.map((e) => ({ etf: e, w: weightsOf(e) })).filter((x) => x.w.size > 0);
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < maps.length; i++) {
    for (let j = i + 1; j < maps.length; j++) {
      const A = maps[i]!;
      const B = maps[j]!;
      const shared: Array<{ name: string; weight: number }> = [];
      for (const [k, va] of A.w) {
        const vb = B.w.get(k);
        if (vb) shared.push({ name: va.name, weight: Math.min(va.weight, vb.weight) });
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
