/**
 * Metais preciosos em custódia (ex.: Elementum) — lógica pura, testável.
 *
 * Modelo:
 * - Compra: o preço guardado é o SPOT por grama; o ágio (prémio sobre o spot)
 *   fica na comissão (`fee`). O custo FIFO = spot + ágio = o que foi pago.
 * - Taxa de armazenamento paga em gramas: entrada "storage" no livro; reduz os
 *   gramas sem venda e o custo total fica nos gramas restantes.
 * - Avaliação: `assets.current_price` = preço de RECOMPRA por grama
 *   (spot × (1 − desconto)), para todo o portefólio valer o que se recebe ao vender.
 */
import type { FifoLot } from "@/lib/fifo";

/** Desconto de recompra por omissão (Elementum: spot − 3 %). */
export const DEFAULT_BUYBACK_DISCOUNT = 0.03;

export function buybackDiscountOf(discount: number | null | undefined): number {
  const d = Number(discount);
  return Number.isFinite(d) && d >= 0 && d < 1 ? d : DEFAULT_BUYBACK_DISCOUNT;
}

/** Preço de recompra por grama a partir do spot. */
export function buybackPrice(spot: number, discount: number): number {
  return spot * (1 - discount);
}

/** Spot por grama a partir do preço de recompra guardado em `current_price`. */
export function spotFromBuyback(buyback: number, discount: number): number {
  return discount < 1 ? buyback / (1 - discount) : 0;
}

export interface MetalPurchaseSplit {
  /** Spot por grama (EUR) — vai para `transactions.price`. */
  spot: number;
  /** Ágio em EUR — vai para `transactions.fee`. */
  premium: number;
  /** Preço pago por grama, ágio incluído (o que o portal mostra). */
  paidPerGram: number;
}

/**
 * Divide uma compra (valor pago, gramas, ágio) em spot + ágio.
 * spot = pago / (gramas × (1 + ágio)); ágio € = pago − gramas × spot.
 */
export function splitMetalPurchase(
  amountPaid: number,
  grams: number,
  premiumRate: number,
): MetalPurchaseSplit {
  if (!(amountPaid > 0)) throw new Error("O valor pago tem de ser positivo.");
  if (!(grams > 0)) throw new Error("Os gramas têm de ser positivos.");
  if (!(premiumRate >= 0 && premiumRate < 1)) throw new Error("Ágio inválido (0–100 %).");
  const spot = amountPaid / (grams * (1 + premiumRate));
  return { spot, premium: amountPaid - grams * spot, paidPerGram: amountPaid / grams };
}

export interface MetalBuy {
  id: string;
  traded_at: string;
  quantity: number;
  /** Spot por grama na compra (EUR). */
  price: number;
  /** Ágio pago (EUR). */
  fee: number;
  premium_rate: number | null;
}

export interface MetalStorageFee {
  id: string;
  incurred_at: string;
  grams: number;
  /** Valor faturado (EUR). */
  amount: number;
  price_per_gram: number | null;
}

export interface MetalLotView {
  id: string;
  traded_at: string;
  /** Valor pago (EUR, ágio incluído). */
  paid: number;
  paidPerGram: number;
  spotAtPurchase: number;
  premiumRate: number | null;
  gramsBought: number;
  /** Gramas que restam deste lote depois das taxas. */
  gramsNow: number;
  valueNow: number;
  pl: number;
}

export interface MetalSummary {
  gramsBought: number;
  gramsDeducted: number;
  gramsHeld: number;
  /** Total pago nas compras (EUR, ágio incluído). */
  invested: number;
  /** Ágio total pago (EUR). */
  premiumPaid: number;
  /** Taxas de armazenamento faturadas (EUR, ao preço do dia de cada taxa). */
  storageBilled: number;
  /** Custo FIFO dos gramas detidos (= investido, sem vendas). */
  costBasis: number;
  avgCostPerGram: number;
  spot: number;
  buyback: number;
  discount: number;
  valueAtSpot: number;
  valueAtBuyback: number;
  /** P/L não realizado ao preço de recompra. */
  unrealizedPL: number;
  unrealizedPct: number;
  /**
   * Decomposição exata do P/L (só sem vendas):
   * preço + ágio + armazenamento + spread de recompra = P/L.
   */
  breakdown: {
    priceEffect: number;
    premium: number;
    storage: number;
    spread: number;
  } | null;
  lots: MetalLotView[];
}

export function summarizeMetal(input: {
  buys: MetalBuy[];
  storage: MetalStorageFee[];
  lots: FifoLot[];
  hasSales: boolean;
  /** `assets.current_price`: preço de recompra por grama (EUR). */
  currentPrice: number;
  discount: number;
}): MetalSummary {
  const { buys, storage, lots, discount } = input;
  const buyback = Math.max(0, Number(input.currentPrice) || 0);
  const spot = spotFromBuyback(buyback, discount);

  const gramsBought = buys.reduce((s, b) => s + b.quantity, 0);
  const gramsDeducted = storage.reduce((s, f) => s + f.grams, 0);
  const gramsHeld = lots.reduce((s, l) => s + l.quantity, 0);
  const spotCost = buys.reduce((s, b) => s + b.quantity * b.price, 0);
  const premiumPaid = buys.reduce((s, b) => s + b.fee, 0);
  const invested = spotCost + premiumPaid;
  const storageBilled = storage.reduce((s, f) => s + f.amount, 0);
  const costBasis = lots.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const valueAtSpot = gramsHeld * spot;
  const valueAtBuyback = gramsHeld * buyback;
  const unrealizedPL = valueAtBuyback - costBasis;

  const byId = new Map(buys.map((b) => [b.id, b]));
  const lotViews: MetalLotView[] = lots
    .filter((l) => l.id && byId.has(l.id))
    .map((l) => {
      const b = byId.get(l.id!)!;
      const paid = b.quantity * b.price + b.fee;
      const cost = l.quantity * l.unitCost;
      const valueNow = l.quantity * buyback;
      return {
        id: b.id,
        traded_at: b.traded_at,
        paid,
        paidPerGram: b.quantity > 0 ? paid / b.quantity : 0,
        spotAtPurchase: b.price,
        premiumRate: b.premium_rate,
        gramsBought: b.quantity,
        gramsNow: l.quantity,
        valueNow,
        pl: valueNow - cost,
      };
    })
    .sort((a, b) => a.traded_at.localeCompare(b.traded_at));

  return {
    gramsBought,
    gramsDeducted,
    gramsHeld,
    invested,
    premiumPaid,
    storageBilled,
    costBasis,
    avgCostPerGram: gramsHeld > 0 ? costBasis / gramsHeld : 0,
    spot,
    buyback,
    discount,
    valueAtSpot,
    valueAtBuyback,
    unrealizedPL,
    unrealizedPct: costBasis > 0 ? unrealizedPL / costBasis : 0,
    breakdown: input.hasSales
      ? null
      : {
          priceEffect: gramsBought * spot - spotCost,
          premium: -premiumPaid,
          storage: -gramsDeducted * spot,
          spread: valueAtBuyback - valueAtSpot,
        },
    lots: lotViews,
  };
}
