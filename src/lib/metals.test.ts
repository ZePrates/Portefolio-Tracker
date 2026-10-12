import { describe, expect, it } from "vitest";
import { buildOpenLots, replayLedger, totalCost, totalQuantity, type LedgerEntry } from "./fifo";
import {
  buybackPrice,
  splitMetalPurchase,
  spotFromBuyback,
  summarizeMetal,
  type MetalBuy,
  type MetalStorageFee,
} from "./metals";

// Extrato real Elementum (prata, Argentum Premium) até 2026-10-12. Gramas pela
// variação do saldo do portal (a linha da compra arredonda: 92,61 / 77,63 / 140,84).
const BUYS: [string, number, number, number][] = [
  // data, EUR pagos, gramas, ágio
  ["2025-10-30", 500, 310.77, 0.1875],
  ["2025-11-27", 400, 248.61, 0.0875],
  ["2025-12-29", 200, 92.62, 0.0875],
  ["2026-01-26", 200, 61.62, 0.0875],
  ["2026-02-03", 200, 77.62, 0.0875],
  ["2026-03-20", 300, 140.85, 0.0875],
  ["2026-04-30", 100, 46.84, 0.0875],
  ["2026-06-02", 50, 21.99, 0.0875],
  ["2026-06-09", 50, 25.28, 0.0875],
  ["2026-06-26", 100, 55.46, 0.0875],
  ["2026-09-08", 50, 25.18, 0.0875],
];
const FEES: [string, number, number, number][] = [
  // data, EUR faturados, EUR/g, gramas
  ["2025-11-04", 0.6, 1.362, 0.44],
  ["2025-12-09", 1.12, 1.425, 0.79],
  ["2026-01-06", 1.65, 1.805, 0.92],
  ["2026-02-04", 2.46, 2.452, 1.0],
  ["2026-03-06", 2.4, 2.159, 1.11],
  ["2026-04-02", 2.84, 2.172, 1.31],
  ["2026-05-06", 2.86, 2.088, 1.37],
  ["2026-06-05", 3.01, 2.197, 1.37],
  ["2026-07-03", 2.79, 1.843, 1.51],
  ["2026-08-05", 2.5, 1.654, 1.51],
  ["2026-09-03", 2.73, 1.811, 1.51],
];

const buys: MetalBuy[] = BUYS.map(([d, eur, g, ag], i) => {
  const s = splitMetalPurchase(eur, g, ag);
  return {
    id: `b${i}`,
    traded_at: d,
    quantity: g,
    price: s.spot,
    fee: s.premium,
    premium_rate: ag,
  };
});
const storage: MetalStorageFee[] = FEES.map(([d, eur, ppg, g], i) => ({
  id: `f${i}`,
  incurred_at: d,
  grams: g,
  amount: eur,
  price_per_gram: ppg,
}));
const entries: LedgerEntry[] = [
  ...buys.map((b) => ({
    id: b.id,
    type: "buy",
    quantity: b.quantity,
    price: b.price,
    fee: b.fee,
    traded_at: b.traded_at,
  })),
  ...storage.map((f) => ({
    type: "storage",
    quantity: f.grams,
    price: f.price_per_gram ?? 0,
    fee: 0,
    traded_at: f.incurred_at,
  })),
];

describe("splitMetalPurchase", () => {
  it("separa spot e ágio sem perder cêntimos", () => {
    const s = splitMetalPurchase(500, 310.77, 0.1875);
    expect(s.paidPerGram).toBeCloseTo(1.6089, 4);
    expect(s.spot).toBeCloseTo(1.3549, 4);
    expect(310.77 * s.spot + s.premium).toBeCloseTo(500, 9);
    expect(s.premium).toBeCloseTo(78.95, 2);
  });
  it("rejeita valores inválidos", () => {
    expect(() => splitMetalPurchase(0, 1, 0.1)).toThrow();
    expect(() => splitMetalPurchase(10, 0, 0.1)).toThrow();
    expect(() => splitMetalPurchase(10, 1, 1)).toThrow();
  });
});

describe("taxas pagas em espécie no livro FIFO", () => {
  it("reconcilia com o extrato: 1.106,84 g − 12,84 g = 1.094,00 g (saldo do portal) e custo 2.150 €", () => {
    const r = replayLedger(entries);
    expect(totalQuantity(r.lots)).toBeCloseTo(1094, 6);
    expect(totalCost(r.lots)).toBeCloseTo(2150, 6);
    expect(r.deductedInKind).toBeCloseTo(12.84, 9);
    expect(r.realizedPL).toBe(0);
    expect(r.sales).toHaveLength(0);
    expect(totalQuantity(buildOpenLots(entries))).toBeCloseTo(1094, 6);
  });
  it("mantém o custo de cada compra e retira gramas na proporção", () => {
    const lots = buildOpenLots([
      { id: "a", type: "buy", quantity: 100, price: 1, traded_at: "2025-01-01" },
      { id: "b", type: "buy", quantity: 300, price: 2, traded_at: "2025-01-02" },
      { type: "storage", quantity: 4, price: 0, traded_at: "2025-02-01" },
    ]);
    expect(lots.map((l) => l.quantity)).toEqual([99, 297]);
    expect(lots[0]!.quantity * lots[0]!.unitCost).toBeCloseTo(100, 9);
    expect(lots[1]!.quantity * lots[1]!.unitCost).toBeCloseTo(600, 9);
  });
  it("só deduz dos lotes existentes nessa data", () => {
    const lots = buildOpenLots([
      { id: "a", type: "buy", quantity: 100, price: 1, traded_at: "2025-01-01" },
      { type: "storage", quantity: 1, price: 0, traded_at: "2025-01-15" },
      { id: "b", type: "buy", quantity: 100, price: 1, traded_at: "2025-02-01" },
    ]);
    expect(lots.map((l) => l.quantity)).toEqual([99, 100]);
  });
  it("recusa deduzir mais do que o detido", () => {
    expect(() =>
      replayLedger([
        { id: "a", type: "buy", quantity: 1, price: 1, traded_at: "2025-01-01" },
        { type: "storage", quantity: 2, price: 0, traded_at: "2025-01-02" },
      ]),
    ).toThrow(/Taxa inválida/);
  });
  it("uma venda depois de taxas usa o custo por grama já ajustado", () => {
    const r = replayLedger([
      { id: "a", type: "buy", quantity: 100, price: 1, traded_at: "2025-01-01" },
      { type: "storage", quantity: 20, price: 0, traded_at: "2025-01-02" },
      { id: "s", type: "sell", quantity: 80, price: 1, traded_at: "2025-01-03" },
    ]);
    expect(r.sales[0]!.costBasis).toBeCloseTo(100, 9);
    expect(r.realizedPL).toBeCloseTo(-20, 9);
  });
});

describe("summarizeMetal", () => {
  const spot = 26182.61 / 15000; // Elementum, 15 kg, 2026-10-11
  const lots = buildOpenLots(entries);
  const s = summarizeMetal({
    buys,
    storage,
    lots,
    hasSales: false,
    currentPrice: buybackPrice(spot, 0.03),
    discount: 0.03,
  });

  it("totais do extrato", () => {
    expect(s.gramsBought).toBeCloseTo(1106.84, 6);
    expect(s.gramsDeducted).toBeCloseTo(12.84, 6);
    expect(s.gramsHeld).toBeCloseTo(1094, 6);
    expect(s.invested).toBeCloseTo(2150, 6);
    expect(s.costBasis).toBeCloseTo(2150, 6);
    expect(s.storageBilled).toBeCloseTo(24.96, 6);
    expect(s.avgCostPerGram).toBeCloseTo(2150 / 1094, 9);
  });
  it("avalia ao spot e à recompra", () => {
    expect(s.spot).toBeCloseTo(spot, 9);
    expect(s.valueAtSpot).toBeCloseTo(1094 * spot, 9);
    expect(s.valueAtBuyback).toBeCloseTo(1094 * spot * 0.97, 9);
    expect(s.unrealizedPL).toBeCloseTo(1094 * spot * 0.97 - 2150, 9);
    expect(s.unrealizedPL).toBeCloseTo(-297.7, 2);
  });
  it("a decomposição soma exatamente o P/L", () => {
    const b = s.breakdown!;
    expect(b.priceEffect + b.premium + b.storage + b.spread).toBeCloseTo(s.unrealizedPL, 9);
    expect(b.premium).toBeCloseTo(-(500 * 0.1875) / 1.1875 - (1650 * 0.0875) / 1.0875, 6);
  });
  it("lotes: valor pago por compra e gramas que restam", () => {
    expect(s.lots).toHaveLength(11);
    expect(s.lots[0]!.paid).toBeCloseTo(500, 9);
    expect(s.lots[0]!.paidPerGram).toBeCloseTo(1.6089, 4);
    expect(s.lots[0]!.gramsNow).toBeLessThan(310.77);
    expect(s.lots[10]!.gramsNow).toBeCloseTo(25.18, 9); // comprado depois da última taxa
    expect(s.lots.reduce((t, l) => t + l.pl, 0)).toBeCloseTo(s.unrealizedPL, 6);
  });
  it("spot ↔ recompra", () => {
    expect(spotFromBuyback(buybackPrice(2, 0.03), 0.03)).toBeCloseTo(2, 12);
  });
});
