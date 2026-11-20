/** Utilitários numéricos da avaliação (puros, sem rede). */

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** a / b, ou null quando algum lado falta ou o divisor é zero. */
export function safeDiv(a: number | null | undefined, b: number | null | undefined): number | null {
  if (!isNum(a) || !isNum(b) || b === 0) return null;
  return a / b;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function mean(values: readonly number[]): number | null {
  const v = values.filter(isNum);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

/** Quantil com interpolação linear (q entre 0 e 1). */
export function quantile(values: readonly number[], q: number): number | null {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

export function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

/** Taxa de crescimento anual composta; null se algum extremo não for positivo. */
export function cagr(
  first: number | null | undefined,
  last: number | null | undefined,
  years: number,
): number | null {
  if (!isNum(first) || !isNum(last) || first <= 0 || last <= 0 || years <= 0) return null;
  return (last / first) ** (1 / years) - 1;
}

/** Série anual, do ano mais antigo para o mais recente. */
export type Series = readonly (number | null)[];

/** Valor do ano `back` anos antes do mais recente (0 = último ano). */
export function at(series: Series | undefined, back = 0): number | null {
  if (!series) return null;
  const v = series[series.length - 1 - back];
  return isNum(v) ? v : null;
}

/** Média dos últimos `n` valores conhecidos. */
export function avgLast(series: Series | undefined, n: number): number | null {
  if (!series) return null;
  const vals = series.slice(-n).filter(isNum);
  return mean(vals);
}

/** Primeiro e último valores conhecidos e a distância em anos entre eles. */
export function span(
  series: Series | undefined,
): { first: number; last: number; years: number } | null {
  if (!series) return null;
  let i0 = -1;
  let i1 = -1;
  for (let i = 0; i < series.length; i++) {
    if (isNum(series[i])) {
      if (i0 < 0) i0 = i;
      i1 = i;
    }
  }
  if (i0 < 0 || i1 <= i0) return null;
  return { first: series[i0] as number, last: series[i1] as number, years: i1 - i0 };
}

/** CAGR entre o primeiro e o último valor conhecidos da série. */
export function seriesCagr(series: Series | undefined): number | null {
  const s = span(series);
  return s ? cagr(s.first, s.last, s.years) : null;
}

/** Gerador pseudo-aleatório reprodutível (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normal padrão (Box-Muller) a partir de um gerador uniforme. */
export function normalSample(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
