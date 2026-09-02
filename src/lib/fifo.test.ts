import { describe, expect, it } from "vitest";
import { applySale, buildOpenLots, totalCost, totalQuantity, type LedgerEntry } from "./fifo";

const buy = (id: string, qty: number, price: number, date: string, fee = 0): LedgerEntry => ({
  id,
  type: "buy",
  quantity: qty,
  price,
  fee,
  traded_at: date,
});

describe("FIFO", () => {
  it("compra 10 @ 100 e vende 4 @ 130", () => {
    const lots = buildOpenLots([buy("l1", 10, 100, "2024-01-01")]);
    const r = applySale(lots, 4, 130);
    expect(r.proceeds).toBe(520);
    expect(r.costBasis).toBe(400);
    expect(r.realizedPL).toBe(120);
    expect(r.remainingQuantity).toBe(6);
    expect(r.remainingCost).toBe(600);
  });

  it("vende as restantes 6 @ 130 → posição fechada, 300 realizados no total", () => {
    const lots = buildOpenLots([
      buy("l1", 10, 100, "2024-01-01"),
      { type: "sell", quantity: 4, price: 130, traded_at: "2024-02-01" },
    ]);
    expect(totalQuantity(lots)).toBe(6);
    const r = applySale(lots, 6, 130);
    expect(r.realizedPL).toBe(180);
    expect(120 + r.realizedPL).toBe(300);
    expect(r.remainingQuantity).toBe(0);
    expect(r.remaining).toHaveLength(0);
  });

  it("venda com prejuízo", () => {
    const lots = buildOpenLots([buy("l1", 10, 100, "2024-01-01")]);
    const r = applySale(lots, 5, 80);
    expect(r.realizedPL).toBe(-100);
  });

  it("comissões reduzem o lucro realizado", () => {
    const lots = buildOpenLots([buy("l1", 10, 100, "2024-01-01")]);
    const r = applySale(lots, 4, 130, 20);
    expect(r.realizedPL).toBe(100);
  });

  it("comissão de compra entra no custo do lote", () => {
    const lots = buildOpenLots([buy("l1", 10, 100, "2024-01-01", 50)]);
    expect(totalCost(lots)).toBe(1050);
    const r = applySale(lots, 10, 110);
    expect(r.realizedPL).toBe(50);
  });

  it("rejeita venda acima da quantidade disponível", () => {
    const lots = buildOpenLots([buy("l1", 10, 100, "2024-01-01")]);
    expect(() => applySale(lots, 11, 130)).toThrow(/só tens/);
  });

  it("duas compras a preços diferentes: venda parcial consome o lote mais antigo", () => {
    const lots = buildOpenLots([
      buy("l1", 10, 100, "2024-01-01"),
      buy("l2", 10, 200, "2024-06-01"),
    ]);
    const r = applySale(lots, 12, 250);
    // 10 @ 100 + 2 @ 200 = 1400 de custo
    expect(r.costBasis).toBe(1400);
    expect(r.proceeds).toBe(3000);
    expect(r.realizedPL).toBe(1600);
    expect(r.breakdown.map((b) => b.lotId)).toEqual(["l1", "l2"]);
    expect(r.breakdown[1]!.quantity).toBe(2);
    expect(r.remainingQuantity).toBe(8);
    expect(r.remainingCost).toBe(1600);
  });
});
