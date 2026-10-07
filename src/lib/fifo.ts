/** Lógica pura de custo FIFO — testável isoladamente. */
import { formatDatePt } from "@/lib/format";

export interface LedgerEntry {
  /** Id da transação (a compra é o lote). */
  id?: string;
  type: string;
  quantity: number;
  /** Preço por unidade em EUR. */
  price: number;
  /** Comissão em EUR associada ao movimento. */
  fee?: number | null;
  traded_at: string;
  created_at?: string;
}

export interface FifoLot {
  /** Id da transação de compra que originou o lote. */
  id?: string;
  /** Quantidade original comprada neste lote. */
  originalQuantity: number;
  /** Quantidade ainda por vender. */
  quantity: number;
  /** Custo por unidade em EUR (inclui comissão de compra repartida). */
  unitCost: number;
  traded_at: string;
}

export interface LotConsumption {
  lotId?: string;
  traded_at: string;
  quantity: number;
  unitCost: number;
  cost: number;
}

export interface SaleResult {
  /** Custo FIFO das unidades vendidas (EUR). */
  costBasis: number;
  /** Produto bruto da venda (EUR). */
  proceeds: number;
  /** Lucro/prejuízo realizado, já líquido de comissões (EUR). */
  realizedPL: number;
  /** Lotes consumidos por esta venda. */
  breakdown: LotConsumption[];
  /** Lotes que permanecem abertos após a venda. */
  remaining: FifoLot[];
  /** Quantidade ainda detida. */
  remainingQuantity: number;
  /** Custo total das unidades ainda detidas (EUR). */
  remainingCost: number;
}

function sortLedger(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => {
    const d = a.traded_at.localeCompare(b.traded_at);
    if (d !== 0) return d;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

/** Reconstrói os lotes abertos a partir do livro de movimentos, aplicando FIFO. */
export function buildOpenLots(entries: LedgerEntry[]): FifoLot[] {
  const lots: FifoLot[] = [];
  for (const e of sortLedger(entries)) {
    const qty = Number(e.quantity) || 0;
    if (qty <= 0) continue;
    if (e.type === "buy") {
      const fee = Number(e.fee ?? 0) || 0;
      lots.push({
        ...(e.id ? { id: e.id } : {}),
        originalQuantity: qty,
        quantity: qty,
        unitCost: (Number(e.price) || 0) + fee / qty,
        traded_at: e.traded_at,
      });
    } else if (e.type === "sell") {
      consume(lots, qty);
    }
  }
  return lots;
}

function consume(lots: FifoLot[], quantity: number): LotConsumption[] {
  let left = quantity;
  const out: LotConsumption[] = [];
  while (left > 1e-9 && lots.length > 0) {
    const lot = lots[0]!;
    const take = Math.min(lot.quantity, left);
    out.push({
      ...(lot.id ? { lotId: lot.id } : {}),
      traded_at: lot.traded_at,
      quantity: take,
      unitCost: lot.unitCost,
      cost: take * lot.unitCost,
    });
    lot.quantity -= take;
    left -= take;
    if (lot.quantity <= 1e-9) lots.shift();
  }
  return out;
}

export function totalQuantity(lots: FifoLot[]): number {
  return lots.reduce((s, l) => s + l.quantity, 0);
}

export function totalCost(lots: FifoLot[]): number {
  return lots.reduce((s, l) => s + l.quantity * l.unitCost, 0);
}

/**
 * Aplica uma venda a um conjunto de lotes abertos, em FIFO.
 * `price` e `fee` em EUR. Lança se a quantidade exceder a detida.
 */
export function applySale(lots: FifoLot[], quantity: number, price: number, fee = 0): SaleResult {
  const working = lots.map((l) => ({ ...l }));
  const held = totalQuantity(working);
  if (quantity <= 0) throw new Error("A quantidade vendida tem de ser positiva.");
  if (quantity > held + 1e-9) {
    throw new Error(`Não podes vender ${quantity} unidades: só tens ${Number(held.toFixed(6))}.`);
  }
  const breakdown = consume(working, quantity);
  const costBasis = breakdown.reduce((s, b) => s + b.cost, 0);
  const proceeds = quantity * price;
  const realizedPL = proceeds - fee - costBasis;
  return {
    costBasis,
    proceeds,
    realizedPL,
    breakdown,
    remaining: working,
    remainingQuantity: totalQuantity(working),
    remainingCost: totalCost(working),
  };
}

export interface ReplayedSale {
  id?: string;
  traded_at: string;
  quantity: number;
  proceeds: number;
  fee: number;
  costBasis: number;
  realizedPL: number;
  breakdown: LotConsumption[];
}

export interface LedgerReplay {
  /** Lotes abertos no fim do livro. */
  lots: FifoLot[];
  /** Cada venda com o seu custo FIFO e P/L realizado. */
  sales: ReplayedSale[];
  realizedPL: number;
  /** Comissões totais (compras e vendas), em EUR. */
  fees: number;
  /** Data da última venda (para `closed_at`). */
  lastSellDate: string | null;
}

/**
 * Repõe todo o livro de movimentos por ordem cronológica e aplica FIFO a
 * cada venda **com os lotes existentes nessa data** (uma venda com data
 * anterior a uma compra nunca consome essa compra).
 * Lança um erro descritivo se, em alguma data, se vender mais do que se detém —
 * deve ser chamada ANTES de gravar qualquer alteração ao livro.
 */
export function replayLedger(entries: LedgerEntry[]): LedgerReplay {
  let lots: FifoLot[] = [];
  const sales: ReplayedSale[] = [];
  let realizedPL = 0;
  let fees = 0;
  let lastSellDate: string | null = null;

  for (const e of sortLedger(entries)) {
    const qty = Number(e.quantity) || 0;
    const price = Number(e.price) || 0;
    const fee = Number(e.fee ?? 0) || 0;
    if (qty <= 0) continue;
    fees += fee;
    if (e.type === "buy") {
      lots.push({
        ...(e.id ? { id: e.id } : {}),
        originalQuantity: qty,
        quantity: qty,
        unitCost: price + fee / qty,
        traded_at: e.traded_at,
      });
    } else if (e.type === "sell") {
      const held = totalQuantity(lots);
      if (qty > held + 1e-9) {
        throw new Error(
          `Movimento inválido: venda de ${Number(qty.toFixed(6))} unidades a ${formatDatePt(e.traded_at)}, mas nessa data só detinhas ${Number(held.toFixed(6))}.`,
        );
      }
      const res = applySale(lots, qty, price, fee);
      lots = res.remaining;
      realizedPL += res.realizedPL;
      lastSellDate = e.traded_at;
      sales.push({
        ...(e.id ? { id: e.id } : {}),
        traded_at: e.traded_at,
        quantity: qty,
        proceeds: res.proceeds,
        fee,
        costBasis: res.costBasis,
        realizedPL: res.realizedPL,
        breakdown: res.breakdown,
      });
    }
  }
  return { lots, sales, realizedPL, fees, lastSellDate };
}

/** Lotes abertos imediatamente após o fim do dia `date` (inclusive). */
export function openLotsAt(entries: LedgerEntry[], date: string): FifoLot[] {
  return replayLedger(entries.filter((e) => e.traded_at.slice(0, 10) <= date)).lots;
}
