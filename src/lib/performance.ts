/**
 * Fase 7 — Performance e análise histórica.
 *
 * Camada de cálculo PURA e determinística. Não faz chamadas externas,
 * não usa LLM e não inventa histórico: tudo é derivado do ledger real
 * (transações), dos dividendos persistidos e do valor de mercado atual.
 *
 * Reutiliza as fontes de verdade existentes:
 *  - FIFO / realizado: `realized_pl` das vendas (portfolio.functions)
 *  - Dividendos: `isReceived` / `netOf` (dividends.ts)
 *  - Posições e valores: portfolio-types.ts
 */

import {
  type Asset,
  type AssetClass,
  CLASS_LABELS,
  assetCurrentValue,
  assetInvested,
  isOpenPosition,
} from "@/lib/portfolio-types";
import { isReceived, netOf, type DividendRecord } from "@/lib/dividends";
import { inRange, todayISO, type DateRange } from "@/lib/dashboard";

/* ------------------------------------------------------------------ */
/* Tipos base                                                          */
/* ------------------------------------------------------------------ */

export interface PerfTransaction {
  asset_id?: string | null;
  type: string; // "buy" | "sell"
  traded_at: string;
  quantity: number;
  price: number;
  fee?: number | null;
  realized_pl?: number | null;
}

/** Valor de mercado da carteira numa data (só de séries reais). */
export interface ValuationPoint {
  date: string;
  value: number;
}

/** Fluxo de capital: positivo = aporte, negativo = levantamento/venda. */
export interface CashFlow {
  date: string;
  amount: number;
}

export type Methodology = "twr" | "mwr" | "simple";

export const METHODOLOGY_LABELS: Record<Methodology, string> = {
  twr: "TWR (Time-Weighted Return)",
  mwr: "MWR / XIRR (Money-Weighted Return)",
  simple: "Retorno simples sobre o capital investido",
};

const EPS = 1e-9;

/* ------------------------------------------------------------------ */
/* Séries a partir do ledger                                           */
/* ------------------------------------------------------------------ */

export interface LedgerSeriesPoint {
  date: string;
  /** Capital líquido aportado até à data (compras + comissões − produto das vendas). */
  netInvested: number;
  /** Custo das unidades ainda detidas (cost basis acumulado). */
  costBasis: number;
  /** Mais/menos-valias realizadas acumuladas. */
  realized: number;
  /** Dividendos líquidos recebidos acumulados. */
  dividends: number;
}

/**
 * Reconstrói a série de capital a partir do ledger real.
 * NÃO estima valor de mercado histórico (não existem snapshots diários).
 */
export function buildLedgerSeries(
  transactions: PerfTransaction[],
  dividends: DividendRecord[],
  today = todayISO(),
): LedgerSeriesPoint[] {
  type Ev = { date: string; net: number; cost: number; realized: number; div: number };
  const events: Ev[] = [];

  for (const t of transactions) {
    const qty = Number(t.quantity) || 0;
    const price = Number(t.price) || 0;
    const fee = Number(t.fee ?? 0) || 0;
    const gross = qty * price;
    if (t.type === "buy") {
      events.push({
        date: t.traded_at.slice(0, 10),
        net: gross + fee,
        cost: gross + fee,
        realized: 0,
        div: 0,
      });
    } else if (t.type === "sell") {
      const realized = Number(t.realized_pl ?? 0) || 0;
      const proceeds = gross - fee;
      // custo das unidades vendidas = produto líquido − resultado realizado
      events.push({
        date: t.traded_at.slice(0, 10),
        net: -proceeds,
        cost: -(proceeds - realized),
        realized,
        div: 0,
      });
    }
  }

  for (const d of dividends) {
    if (!isReceived(d, today)) continue;
    events.push({
      date: (d.payment_date ?? d.paid_at).slice(0, 10),
      net: 0,
      cost: 0,
      realized: 0,
      div: netOf(d),
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  const out = new Map<string, LedgerSeriesPoint>();
  let net = 0;
  let cost = 0;
  let realized = 0;
  let div = 0;
  for (const e of events) {
    net += e.net;
    cost += e.cost;
    realized += e.realized;
    div += e.div;
    out.set(e.date, { date: e.date, netInvested: net, costBasis: cost, realized, dividends: div });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fluxos de capital externos (aportes/levantamentos) a partir do ledger.
 * Compras são entradas de capital, vendas são saídas. Dividendos recebidos
 * não são fluxos externos de capital investido — são rendimento.
 */
export function cashFlowsFromLedger(transactions: PerfTransaction[]): CashFlow[] {
  const map = new Map<string, number>();
  for (const t of transactions) {
    const qty = Number(t.quantity) || 0;
    const price = Number(t.price) || 0;
    const fee = Number(t.fee ?? 0) || 0;
    const date = t.traded_at.slice(0, 10);
    const amount =
      t.type === "buy" ? qty * price + fee : t.type === "sell" ? -(qty * price - fee) : 0;
    if (amount === 0) continue;
    map.set(date, (map.get(date) ?? 0) + amount);
  }
  return [...map.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ */
/* TWR — Time-Weighted Return                                          */
/* ------------------------------------------------------------------ */

export interface PeriodReturn {
  from: string;
  to: string;
  /** Retorno do sub-período, em fração (0.1 = +10%). */
  r: number;
}

export interface TwrResult {
  /** Retorno total encadeado, em % (null quando não calculável). */
  totalPct: number | null;
  periods: PeriodReturn[];
  /** Razão pela qual não foi possível calcular. */
  unavailable: string | null;
  methodology: Methodology;
}

/**
 * TWR: encadeia retornos de sub-períodos entre valorizações consecutivas,
 * neutralizando o efeito de aportes/levantamentos.
 *
 *   r_i = (V_fim − F_i) / V_inicio − 1        (fluxos assumidos no fim do sub-período)
 *
 * Requer pelo menos duas valorizações reais. Nunca estima valorizações.
 */
export function twr(valuations: ValuationPoint[], flows: CashFlow[] = []): TwrResult {
  const vs = [...valuations]
    .filter((v) => Number.isFinite(v.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (vs.length < 2) {
    return {
      totalPct: null,
      periods: [],
      unavailable: "Histórico de valorizações insuficiente (mínimo 2 observações).",
      methodology: "twr",
    };
  }

  const periods: PeriodReturn[] = [];
  let chained = 1;
  for (let i = 1; i < vs.length; i++) {
    const prev = vs[i - 1]!;
    const cur = vs[i]!;
    if (prev.value <= EPS) {
      // Sub-período sem capital inicial: ignorado (não distorce a série).
      continue;
    }
    const f = flows
      .filter((x) => x.date > prev.date && x.date <= cur.date)
      .reduce((s, x) => s + x.amount, 0);
    const r = (cur.value - f) / prev.value - 1;
    periods.push({ from: prev.date, to: cur.date, r });
    chained *= 1 + r;
  }

  if (periods.length === 0) {
    return {
      totalPct: null,
      periods: [],
      unavailable: "Sem sub-períodos com capital inicial positivo.",
      methodology: "twr",
    };
  }

  return { totalPct: (chained - 1) * 100, periods, unavailable: null, methodology: "twr" };
}

/* ------------------------------------------------------------------ */
/* XIRR / MWR — Money-Weighted Return                                  */
/* ------------------------------------------------------------------ */

function yearFraction(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return (b - a) / (365 * 24 * 3600 * 1000);
}

function npv(rate: number, flows: CashFlow[], base: string): number {
  return flows.reduce((s, f) => s + f.amount / Math.pow(1 + rate, yearFraction(base, f.date)), 0);
}

export interface XirrResult {
  /** Taxa anualizada em % (null quando não calculável). */
  annualizedPct: number | null;
  unavailable: string | null;
  methodology: Methodology;
}

/**
 * XIRR sobre fluxos com sinal: aportes negativos para o investidor
 * (saída de dinheiro), valor final e rendimentos positivos.
 * Bissecção robusta (sem depender de derivadas mal condicionadas).
 */
export function xirr(flows: CashFlow[]): XirrResult {
  const rows = [...flows]
    .filter((f) => Number.isFinite(f.amount) && f.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (rows.length < 2) {
    return {
      annualizedPct: null,
      unavailable: "Fluxos de caixa insuficientes.",
      methodology: "mwr",
    };
  }
  const hasPos = rows.some((f) => f.amount > 0);
  const hasNeg = rows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) {
    return {
      annualizedPct: null,
      unavailable: "Fluxos sem sinais opostos — taxa não determinável.",
      methodology: "mwr",
    };
  }

  const base = rows[0]!.date;
  if (yearFraction(base, rows[rows.length - 1]!.date) < 1 / 365) {
    return { annualizedPct: null, unavailable: "Período demasiado curto.", methodology: "mwr" };
  }

  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo, rows, base);
  let fHi = npv(hi, rows, base);
  if (fLo * fHi > 0) {
    return { annualizedPct: null, unavailable: "Não foi possível convergir.", methodology: "mwr" };
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, rows, base);
    if (Math.abs(fMid) < 1e-9)
      return { annualizedPct: mid * 100, unavailable: null, methodology: "mwr" };
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  void fHi;
  return { annualizedPct: ((lo + hi) / 2) * 100, unavailable: null, methodology: "mwr" };
}

/**
 * Fluxos prontos para XIRR a partir do ledger + dividendos + valor atual.
 * Convenção do investidor: compras negativas, vendas/dividendos positivos,
 * valor de mercado atual como fluxo final positivo.
 */
export function xirrFlows(
  transactions: PerfTransaction[],
  dividends: DividendRecord[],
  currentValue: number,
  today = todayISO(),
): CashFlow[] {
  const flows: CashFlow[] = cashFlowsFromLedger(transactions).map((f) => ({
    date: f.date,
    amount: -f.amount,
  }));
  for (const d of dividends) {
    if (!isReceived(d, today)) continue;
    flows.push({ date: (d.payment_date ?? d.paid_at).slice(0, 10), amount: netOf(d) });
  }
  if (currentValue > 0) flows.push({ date: today, amount: currentValue });
  return flows.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ */
/* Drawdown                                                            */
/* ------------------------------------------------------------------ */

export interface DrawdownResult {
  /** Máximo drawdown histórico em % (valor negativo ou 0). */
  maxPct: number | null;
  maxFrom: string | null;
  maxTo: string | null;
  /** Drawdown atual face ao pico histórico, em %. */
  currentPct: number | null;
  peak: number | null;
  unavailable: string | null;
}

/**
 * Drawdown sobre uma série real de valores (peak-to-trough):
 *   dd_t = V_t / max(V_0..V_t) − 1
 */
export function drawdown(series: ValuationPoint[]): DrawdownResult {
  const vs = [...series]
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (vs.length < 2) {
    return {
      maxPct: null,
      maxFrom: null,
      maxTo: null,
      currentPct: null,
      peak: null,
      unavailable: "Série histórica insuficiente (mínimo 2 observações).",
    };
  }

  let peak = vs[0]!.value;
  let peakDate = vs[0]!.date;
  let maxPct = 0;
  let maxFrom: string | null = null;
  let maxTo: string | null = null;

  for (const p of vs) {
    if (p.value > peak) {
      peak = p.value;
      peakDate = p.date;
    }
    if (peak > EPS) {
      const dd = (p.value / peak - 1) * 100;
      if (dd < maxPct) {
        maxPct = dd;
        maxFrom = peakDate;
        maxTo = p.date;
      }
    }
  }

  const last = vs[vs.length - 1]!.value;
  return {
    maxPct,
    maxFrom,
    maxTo,
    currentPct: peak > EPS ? (last / peak - 1) * 100 : null,
    peak,
    unavailable: null,
  };
}

/* ------------------------------------------------------------------ */
/* Estatísticas de períodos                                            */
/* ------------------------------------------------------------------ */

export interface ReturnStats {
  observations: number;
  bestPct: number | null;
  worstPct: number | null;
  /** Desvio-padrão amostral dos retornos por período, em %. */
  volatilityPct: number | null;
  avgGainPct: number | null;
  avgLossPct: number | null;
  positiveRatePct: number | null;
  unavailable: string | null;
}

const MIN_OBS = 3;
const MIN_OBS_VOL = 6;

/** Estatísticas só quando há observações suficientes (sem métricas frágeis). */
export function returnStats(periods: PeriodReturn[], minObs = MIN_OBS): ReturnStats {
  const rs = periods.map((p) => p.r).filter((r) => Number.isFinite(r));
  if (rs.length < minObs) {
    return {
      observations: rs.length,
      bestPct: null,
      worstPct: null,
      volatilityPct: null,
      avgGainPct: null,
      avgLossPct: null,
      positiveRatePct: null,
      unavailable: `Observações insuficientes (${rs.length} de ${minObs}).`,
    };
  }
  const gains = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const mean = rs.reduce((s, r) => s + r, 0) / rs.length;
  const variance = rs.reduce((s, r) => s + (r - mean) ** 2, 0) / (rs.length - 1);

  return {
    observations: rs.length,
    bestPct: Math.max(...rs) * 100,
    worstPct: Math.min(...rs) * 100,
    volatilityPct: rs.length >= MIN_OBS_VOL ? Math.sqrt(variance) * 100 : null,
    avgGainPct: gains.length > 0 ? (gains.reduce((s, r) => s + r, 0) / gains.length) * 100 : null,
    avgLossPct:
      losses.length > 0 ? (losses.reduce((s, r) => s + r, 0) / losses.length) * 100 : null,
    positiveRatePct: (gains.length / rs.length) * 100,
    unavailable: null,
  };
}

/* ------------------------------------------------------------------ */
/* Contribuição por ativo e por classe                                 */
/* ------------------------------------------------------------------ */

export interface AssetContribution {
  assetId: string | null;
  name: string;
  class: AssetClass | null;
  /** Valorização latente das unidades ainda detidas. */
  appreciation: number;
  /** Mais/menos-valias realizadas no período. */
  realized: number;
  /** Dividendos líquidos recebidos no período. */
  dividends: number;
  total: number;
}

/**
 * Contribuição de cada ativo para o resultado, separando valorização,
 * realização (vendas, via FIFO já persistido) e dividendos.
 * Realizado e dividendos são filtrados pelo período; a valorização latente
 * é sempre a posição atual (não existe histórico de preços por data).
 */
export function contributionByAsset(
  assets: Asset[],
  transactions: PerfTransaction[],
  dividends: DividendRecord[],
  range: DateRange,
  today = todayISO(),
): AssetContribution[] {
  const map = new Map<string, AssetContribution>();
  const keyOf = (id: string | null, name: string) => id ?? `name:${name}`;

  const ensure = (id: string | null, name: string, cls: AssetClass | null) => {
    const key = keyOf(id, name);
    const cur =
      map.get(key) ??
      ({
        assetId: id,
        name,
        class: cls,
        appreciation: 0,
        realized: 0,
        dividends: 0,
        total: 0,
      } satisfies AssetContribution);
    if (cls && !cur.class) cur.class = cls;
    map.set(key, cur);
    return cur;
  };

  const byId = new Map(assets.map((a) => [a.id, a]));

  for (const a of assets) {
    const row = ensure(a.id, a.name, a.class);
    if (isOpenPosition(a)) row.appreciation += assetCurrentValue(a) - assetInvested(a);
  }

  for (const t of transactions) {
    if (t.type !== "sell" || !inRange(t.traded_at, range)) continue;
    const a = t.asset_id ? byId.get(t.asset_id) : undefined;
    const row = ensure(t.asset_id ?? null, a?.name ?? "Posição encerrada", a?.class ?? null);
    row.realized += Number(t.realized_pl ?? 0) || 0;
  }

  for (const d of dividends) {
    if (!isReceived(d, today)) continue;
    const date = (d.payment_date ?? d.paid_at).slice(0, 10);
    if (!inRange(date, range)) continue;
    const a = d.asset_id ? byId.get(d.asset_id) : undefined;
    const row = ensure(d.asset_id, a?.name ?? d.asset_name, a?.class ?? null);
    row.dividends += netOf(d);
  }

  return [...map.values()]
    .map((r) => ({ ...r, total: r.appreciation + r.realized + r.dividends }))
    .filter((r) => Math.abs(r.total) > 1e-6)
    .sort((a, b) => b.total - a.total);
}

export interface ClassPerformance {
  class: AssetClass;
  label: string;
  value: number;
  invested: number;
  unrealized: number;
  realized: number;
  dividends: number;
  totalResult: number;
  /** (resultado total) / capital investido, em % (null se sem base). */
  returnPct: number | null;
  count: number;
}

export function performanceByClass(
  assets: Asset[],
  dividends: DividendRecord[],
  range: DateRange,
  today = todayISO(),
): ClassPerformance[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const divByClass = new Map<AssetClass, number>();
  for (const d of dividends) {
    if (!isReceived(d, today)) continue;
    const date = (d.payment_date ?? d.paid_at).slice(0, 10);
    if (!inRange(date, range)) continue;
    const a = d.asset_id ? byId.get(d.asset_id) : undefined;
    if (!a) continue;
    divByClass.set(a.class, (divByClass.get(a.class) ?? 0) + netOf(d));
  }

  return (Object.keys(CLASS_LABELS) as AssetClass[])
    .map((c) => {
      const rows = assets.filter((a) => a.class === c);
      const value = rows.reduce((s, a) => s + assetCurrentValue(a), 0);
      const invested = rows.reduce((s, a) => s + assetInvested(a), 0);
      const realized = rows.reduce((s, a) => s + (Number(a.realized_pl) || 0), 0);
      const divs = divByClass.get(c) ?? 0;
      const unrealized = value - invested;
      const closedCost = rows
        .filter((a) => !isOpenPosition(a))
        .reduce((s, a) => s + (Number(a.invested_amount) || 0), 0);
      const basis = invested + closedCost;
      const totalResult = unrealized + realized + divs;
      return {
        class: c,
        label: CLASS_LABELS[c],
        value,
        invested,
        unrealized,
        realized,
        dividends: divs,
        totalResult,
        returnPct: basis > 0 ? (totalResult / basis) * 100 : null,
        count: rows.length,
      };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.value - a.value);
}

/* ------------------------------------------------------------------ */
/* Resultado consolidado do período                                    */
/* ------------------------------------------------------------------ */

export interface PeriodPerformance {
  range: DateRange;
  /** Valorização latente atual (posições abertas). */
  unrealized: number;
  /** Realizado dentro do período. */
  realized: number;
  /** Dividendos líquidos recebidos dentro do período. */
  dividends: number;
  /** Resultado absoluto em EUR do período (sem dupla contagem). */
  absolute: number;
  /** Retorno simples: resultado / capital investido de base. */
  simplePct: number | null;
  basis: number;
  twr: TwrResult;
  mwr: XirrResult;
}

/**
 * Resultado do período. O retorno percentual "simples" é declarado
 * explicitamente como tal; TWR/MWR são calculados quando houver dados.
 */
export function periodPerformance(
  assets: Asset[],
  transactions: PerfTransaction[],
  dividends: DividendRecord[],
  range: DateRange,
  valuations: ValuationPoint[] = [],
  today = todayISO(),
): PeriodPerformance {
  const open = assets.filter(isOpenPosition);
  const currentValue = open.reduce((s, a) => s + assetCurrentValue(a), 0);
  const costBasis = open.reduce((s, a) => s + assetInvested(a), 0);
  const closedCost = assets
    .filter((a) => !isOpenPosition(a))
    .reduce((s, a) => s + (Number(a.invested_amount) || 0), 0);

  const unrealized = currentValue - costBasis;
  const realized = transactions
    .filter((t) => t.type === "sell" && inRange(t.traded_at, range))
    .reduce((s, t) => s + (Number(t.realized_pl ?? 0) || 0), 0);
  const divs = dividends
    .filter(
      (d) => isReceived(d, today) && inRange((d.payment_date ?? d.paid_at).slice(0, 10), range),
    )
    .reduce((s, d) => s + netOf(d), 0);

  const basis = costBasis + closedCost;
  const absolute = unrealized + realized + divs;

  const inWindow = valuations.filter((v) => v.date >= range.from && v.date <= range.to);
  const flows = cashFlowsFromLedger(transactions).filter(
    (f) => f.date >= range.from && f.date <= range.to,
  );

  return {
    range,
    unrealized,
    realized,
    dividends: divs,
    absolute,
    simplePct: basis > 0 ? (absolute / basis) * 100 : null,
    basis,
    twr: twr(inWindow, flows),
    mwr: xirr(xirrFlows(transactions, dividends, currentValue, today)),
  };
}
