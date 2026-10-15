/**
 * Reconstrução do histórico diário da carteira a partir do livro de
 * movimentos e de preços de fecho históricos — lógica pura, sem rede.
 *
 * Para cada dia de calendário, desde o primeiro movimento até `to`:
 * - Títulos: unidades detidas × fecho do dia (o último fecho conhecido nos
 *   fins de semana e feriados) × câmbio desse dia para EUR.
 * - Metais: gramas (compras − taxas pagas em gramas) × preço de recompra
 *   por grama (spot em USD/oz → EUR/g × (1 − desconto)).
 * - P2P: depósitos + juros + bónus − levantamentos − comissões. As compras de
 *   créditos e os reembolsos de capital só passam dinheiro entre a caixa e os
 *   créditos, por isso não mudam o valor.
 * - Investido: compras − custo do que foi vendido (P2P: depósitos − levantamentos).
 *
 * Sem preço histórico (antes do início da série no Yahoo), o título vale o
 * preço da última compra e fica listado em `atCost`.
 */
import { addDaysISO } from "@/lib/dates";
import { TROY_OUNCE_GRAMS } from "@/lib/prices";

export interface RebuildAsset {
  id: string;
  /** Classe (etf, reit, metal, p2p, …) — dá o âmbito `class:<classe>`. */
  class: string;
  name: string;
  /** Símbolo Yahoo do preço (títulos e metais). */
  symbol: string | null;
  /** Desconto de recompra (metais). */
  buybackDiscount?: number | undefined;
}

export interface RebuildTransaction {
  assetId: string;
  /** "buy" | "sell"; outros tipos são ignorados. */
  type: string;
  date: string;
  quantity: number;
  /** Total em EUR (com comissões). */
  total: number;
  /** Mais-valia realizada em EUR (vendas). */
  realizedPl: number | null;
}

export interface RebuildGramDeduction {
  assetId: string;
  date: string;
  grams: number;
}

export interface RebuildP2pCash {
  assetId: string;
  date: string;
  type: string;
  amount: number;
}

export interface DatedValue {
  date: string;
  value: number;
}

export interface PriceHistory {
  /** Moeda do fecho já normalizada (GBp → GBP com factor 0,01). */
  currency: string;
  factor: number;
  points: DatedValue[];
}

export interface RebuildRow {
  date: string;
  scope: string;
  invested: number;
  value: number;
}

export interface RebuildResult {
  rows: RebuildRow[];
  from: string | null;
  to: string;
  /** Ativos avaliados ao preço de compra em algum dia (sem fecho histórico). */
  atCost: string[];
  /** Moedas sem câmbio histórico (os ativos nessa moeda ficam ao custo). */
  missingFx: string[];
}

/** Valor em vigor num dia: o último ponto com data ≤ dia (séries ordenadas). */
class ForwardFill {
  private i = -1;
  constructor(private readonly points: DatedValue[]) {}
  at(date: string): number | null {
    while (this.i + 1 < this.points.length && this.points[this.i + 1]!.date <= date) this.i += 1;
    return this.i >= 0 ? this.points[this.i]!.value : null;
  }
}

const P2P_FLOW_ONLY = new Set(["purchase", "principal"]);
const P2P_CAPITAL = new Set(["deposit", "withdrawal"]);

const round2 = (n: number) => Math.round(n * 100) / 100;
const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);

export function rebuildHistory(input: {
  assets: RebuildAsset[];
  transactions: RebuildTransaction[];
  gramDeductions?: RebuildGramDeduction[];
  p2pCash?: RebuildP2pCash[];
  /** Por símbolo Yahoo. */
  prices: Map<string, PriceHistory>;
  /** Câmbio <MOEDA>→EUR por moeda (EUR não precisa). */
  fx: Map<string, DatedValue[]>;
  /** Último dia a reconstruir (inclusive), normalmente ontem. */
  to: string;
}): RebuildResult {
  const assets = new Map(input.assets.map((a) => [a.id, a]));
  const txs = input.transactions
    .filter((t) => (t.type === "buy" || t.type === "sell") && assets.has(t.assetId))
    .sort(byDate);
  const deductions = [...(input.gramDeductions ?? [])].sort(byDate);
  const p2p = (input.p2pCash ?? [])
    .filter((m) => assets.get(m.assetId)?.class === "p2p")
    .sort(byDate);

  const starts = [txs[0]?.date, p2p[0]?.date].filter((d): d is string => !!d);
  const from = starts.length > 0 ? starts.sort()[0]! : null;
  const empty: RebuildResult = { rows: [], from, to: input.to, atCost: [], missingFx: [] };
  if (!from || from > input.to) return empty;

  const priceFill = new Map<string, ForwardFill>();
  for (const [symbol, h] of input.prices) priceFill.set(symbol, new ForwardFill(h.points));
  const fxFill = new Map<string, ForwardFill>();
  for (const [cur, pts] of input.fx) fxFill.set(cur.toUpperCase(), new ForwardFill(pts));

  const qty = new Map<string, number>();
  const invested = new Map<string, number>();
  const lastBuyPrice = new Map<string, number>();
  const atCost = new Set<string>();
  const missingFx = new Set<string>();
  const p2pInvested = new Map<string, number>();
  const p2pValue = new Map<string, number>();
  let ti = 0;
  let di = 0;
  let pi = 0;
  const rows: RebuildRow[] = [];

  const fxRate = (currency: string, date: string): number | null => {
    const cur = currency.toUpperCase();
    if (cur === "EUR") return 1;
    const r = fxFill.get(cur)?.at(date) ?? null;
    if (r == null) missingFx.add(cur);
    return r;
  };

  /** Preço por unidade em EUR num dia; null quando falta o fecho ou o câmbio. */
  const unitPriceEur = (a: RebuildAsset, date: string): number | null => {
    if (!a.symbol) return null;
    const h = input.prices.get(a.symbol);
    const close = priceFill.get(a.symbol)?.at(date) ?? null;
    if (!h || close == null) return null;
    const rate = fxRate(h.currency, date);
    if (rate == null) return null;
    if (a.class === "metal") {
      return (close / TROY_OUNCE_GRAMS) * rate * (1 - (a.buybackDiscount ?? 0));
    }
    return close * h.factor * rate;
  };

  for (let date = from; date <= input.to; date = addDaysISO(date, 1)) {
    for (; ti < txs.length && txs[ti]!.date <= date; ti += 1) {
      const t = txs[ti]!;
      const q = qty.get(t.assetId) ?? 0;
      const inv = invested.get(t.assetId) ?? 0;
      if (t.type === "buy") {
        qty.set(t.assetId, q + t.quantity);
        invested.set(t.assetId, inv + t.total);
        if (t.quantity > 0) lastBuyPrice.set(t.assetId, t.total / t.quantity);
      } else {
        // Custo do que saiu = valor da venda − mais-valia; sem ela, custo médio.
        const cost =
          t.realizedPl != null ? t.total - t.realizedPl : q > 0 ? (inv * t.quantity) / q : 0;
        qty.set(t.assetId, Math.max(0, q - t.quantity));
        invested.set(t.assetId, Math.max(0, inv - cost));
      }
    }
    for (; di < deductions.length && deductions[di]!.date <= date; di += 1) {
      const d = deductions[di]!;
      qty.set(d.assetId, Math.max(0, (qty.get(d.assetId) ?? 0) - d.grams));
    }
    for (; pi < p2p.length && p2p[pi]!.date <= date; pi += 1) {
      const m = p2p[pi]!;
      if (P2P_CAPITAL.has(m.type)) {
        p2pInvested.set(m.assetId, (p2pInvested.get(m.assetId) ?? 0) + m.amount);
      }
      if (!P2P_FLOW_ONLY.has(m.type)) {
        p2pValue.set(m.assetId, (p2pValue.get(m.assetId) ?? 0) + m.amount);
      }
    }

    const byClass = new Map<string, { invested: number; value: number }>();
    const add = (cls: string, inv: number, val: number) => {
      const c = byClass.get(cls) ?? { invested: 0, value: 0 };
      c.invested += inv;
      c.value += val;
      byClass.set(cls, c);
    };

    for (const [id, q] of qty) {
      const a = assets.get(id)!;
      const inv = invested.get(id) ?? 0;
      if (q <= 1e-9) {
        if (inv > 0.005) add(a.class, inv, 0);
        continue;
      }
      let price = unitPriceEur(a, date);
      if (price == null) {
        price = lastBuyPrice.get(id) ?? 0;
        atCost.add(a.name);
      }
      add(a.class, inv, q * price);
    }
    for (const id of new Set([...p2pInvested.keys(), ...p2pValue.keys()])) {
      const inv = Math.max(0, p2pInvested.get(id) ?? 0);
      const val = Math.max(0, p2pValue.get(id) ?? 0);
      if (inv > 0 || val > 0) add("p2p", inv, val);
    }

    if (byClass.size === 0) continue;
    let totalInv = 0;
    let totalVal = 0;
    for (const [cls, c] of byClass) {
      totalInv += c.invested;
      totalVal += c.value;
      rows.push({
        date,
        scope: `class:${cls}`,
        invested: round2(c.invested),
        value: round2(c.value),
      });
    }
    rows.push({ date, scope: "total", invested: round2(totalInv), value: round2(totalVal) });
  }

  return {
    rows,
    from,
    to: input.to,
    atCost: [...atCost].sort(),
    missingFx: [...missingFx].sort(),
  };
}
