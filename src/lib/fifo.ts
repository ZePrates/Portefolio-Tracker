/** Lógica pura de custo FIFO — testável isoladamente. */

export interface LedgerEntry {
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
  quantity: number;
  /** Custo por unidade em EUR (inclui comissão de compra repartida). */
  unitCost: number;
}

export interface SaleResult {
  /** Custo FIFO das unidades vendidas (EUR). */
  costBasis: number;
  /** Produto bruto da venda (EUR). */
  proceeds: number;
  /** Lucro/prejuízo realizado, já líquido de comissões (EUR). */
  realizedPL: number;
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
      lots.push({ quantity: qty, unitCost: (Number(e.price) || 0) + fee / qty });
    } else if (e.type === "sell") {
      consume(lots, qty);
    }
  }
  return lots;
}

function consume(lots: FifoLot[], quantity: number): number {
  let left = quantity;
  let cost = 0;
  while (left > 1e-9 && lots.length > 0) {
    const lot = lots[0]!;
    const take = Math.min(lot.quantity, left);
    cost += take * lot.unitCost;
    lot.quantity -= take;
    left -= take;
    if (lot.quantity <= 1e-9) lots.shift();
  }
  return cost;
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
export function applySale(
  lots: FifoLot[],
  quantity: number,
  price: number,
  fee = 0,
): SaleResult {
  const working = lots.map((l) => ({ ...l }));
  const held = totalQuantity(working);
  if (quantity <= 0) throw new Error("A quantidade vendida tem de ser positiva.");
  if (quantity > held + 1e-9) {
    throw new Error(
      `Não podes vender ${quantity} unidades: só tens ${Number(held.toFixed(6))}.`,
    );
  }
  const costBasis = consume(working, quantity);
  const proceeds = quantity * price;
  const realizedPL = proceeds - fee - costBasis;
  return {
    costBasis,
    proceeds,
    realizedPL,
    remaining: working,
    remainingQuantity: totalQuantity(working),
    remainingCost: totalCost(working),
  };
}
