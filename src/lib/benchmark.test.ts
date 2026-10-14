import { describe, expect, it } from "vitest";
import { benchmarkComparison, SP500_ANNUAL_RETURN_PCT } from "@/lib/benchmark";
import type { PerfTransaction } from "@/lib/performance";
import type { Asset } from "@/lib/portfolio-types";
import type { DividendRecord } from "@/lib/dividends";

const asset = (p: Partial<Asset> & { id: string }): Asset =>
  ({
    user_id: "u",
    class: "etf",
    ticker: null,
    isin: null,
    name: p.id,
    quantity: 0,
    average_price: 0,
    current_price: 0,
    invested_amount: 0,
    current_value: 0,
    status: "open",
    ...p,
  }) as Asset;

const buy = (asset_id: string, traded_at: string, amount: number): PerfTransaction => ({
  asset_id,
  type: "buy",
  traded_at,
  quantity: 1,
  price: amount,
  fee: 0,
});

describe("benchmarkComparison", () => {
  it("sem movimentos → null", () => {
    expect(benchmarkComparison([], [], [], "2026-10-14")).toBeNull();
  });

  it("um aporte de 1000 € cresce 10,56 % num ano", () => {
    const c = benchmarkComparison(
      [asset({ id: "a", quantity: 1, current_price: 1200 })],
      [buy("a", "2025-01-01", 1000)],
      [],
      "2026-01-01",
    )!;
    expect(c.annualReturnPct).toBe(SP500_ANNUAL_RETURN_PCT);
    expect(c.benchmark).toBeCloseTo(1000 * 1.1056, 6);
    expect(c.invested).toBe(1000);
    expect(c.portfolio).toBe(1200);
    expect(c.difference).toBeCloseTo(1200 - 1105.6, 6);
    expect(c.differencePct).toBeCloseTo(((1200 - 1105.6) / 1105.6) * 100, 6);
  });

  it("série mensal até hoje, com o último ponto igual ao total", () => {
    const c = benchmarkComparison(
      [asset({ id: "a", quantity: 1, current_price: 3000 })],
      [buy("a", "2026-01-15", 1000), buy("a", "2026-03-10", 2000)],
      [],
      "2026-04-20",
    )!;
    expect(c.series.map((p) => p.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-20",
    ]);
    expect(c.series.map((p) => p.invested)).toEqual([1000, 1000, 3000, 3000]);
    expect(c.series.at(-1)!.benchmark).toBeCloseTo(c.benchmark, 9);
    const expected = 1000 * Math.pow(1.1056, 95 / 365) + 2000 * Math.pow(1.1056, 41 / 365);
    expect(c.benchmark).toBeCloseTo(expected, 6);
  });

  it("vendas retiram o mesmo dinheiro do benchmark", () => {
    const c = benchmarkComparison(
      [asset({ id: "a", quantity: 0 })],
      [
        buy("a", "2025-01-01", 1000),
        { asset_id: "a", type: "sell", traded_at: "2026-01-01", quantity: 1, price: 1105.6 },
      ],
      [],
      "2026-01-01",
    )!;
    expect(c.benchmark).toBeCloseTo(0, 6);
    expect(c.invested).toBeCloseTo(-105.6, 6);
  });

  it("só conta ativos e dividendos com movimentos no ledger", () => {
    const divs: DividendRecord[] = [
      {
        asset_id: "a",
        asset_name: "A",
        amount: 50,
        net_amount: 40,
        paid_at: "2025-06-01",
        status: "received",
      },
      { asset_id: "p2p", asset_name: "P2P", amount: 99, paid_at: "2025-06-01", status: "received" },
    ];
    const c = benchmarkComparison(
      [
        asset({ id: "a", quantity: 1, current_price: 1100 }),
        asset({ id: "p2p", class: "p2p", current_value: 5000, invested_amount: 5000 }),
      ],
      [buy("a", "2025-01-01", 1000)],
      divs,
      "2026-01-01",
    )!;
    expect(c.portfolioValue).toBe(1100);
    expect(c.dividends).toBe(40);
    expect(c.portfolio).toBe(1140);
  });
});
