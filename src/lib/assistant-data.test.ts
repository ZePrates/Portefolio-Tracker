import { describe, expect, it } from "vitest";
import {
  dividendReport,
  norm,
  realizedReport,
  round,
  roundDeep,
  snapshotReport,
  type AssistantDividendRow,
} from "./assistant-data";

const div = (over: Partial<AssistantDividendRow>): AssistantDividendRow => ({
  asset_id: "a1",
  asset_name: "Realty Income",
  amount: 10,
  paid_at: "2026-03-15",
  payment_date: "2026-03-15",
  net_amount: 8,
  gross_amount: 10,
  status: "received",
  ...over,
});

describe("norm / round", () => {
  it("remove acentos e passa a minúsculas", () => {
    expect(norm("  Ações Dividendos ")).toBe("acoes dividendos");
  });
  it("round trata nulos e valores não finitos", () => {
    expect(round(null)).toBeNull();
    expect(round(Number.NaN)).toBeNull();
    expect(round(1.2345, 2)).toBe(1.23);
  });
  it("roundDeep arredonda números aninhados e preserva o resto", () => {
    expect(roundDeep({ a: 1.23456, b: [2.345678, "x"], c: null, d: { e: 3.14159 } })).toEqual({
      a: 1.23,
      b: [2.35, "x"],
      c: null,
      d: { e: 3.14 },
    });
  });
});

describe("dividendReport", () => {
  const rows = [
    div({}),
    div({ paid_at: "2026-06-15", payment_date: "2026-06-15", net_amount: 12, gross_amount: 15 }),
    div({
      asset_name: "Apple",
      paid_at: "2025-11-01",
      payment_date: "2025-11-01",
      net_amount: 1,
      gross_amount: 1.2,
    }),
    div({
      paid_at: "2026-12-15",
      payment_date: "2026-12-15",
      status: "scheduled",
      net_amount: 9,
      gross_amount: 11,
    }),
    div({
      asset_name: "Apple",
      paid_at: "2026-04-01",
      payment_date: "2026-04-01",
      net_amount: 2,
      gross_amount: 2.5,
      payment_date_estimated: true,
    }),
  ];

  it("separa recebidos e por receber, líquido e bruto", () => {
    const r = dividendReport(rows, { year: 2026, today: "2026-10-31" });
    expect(r.received).toEqual({ net: 22, gross: 27.5, tax: 5.5, count: 3 });
    expect(r.scheduled).toEqual({ net: 9, count: 1 });
    expect(r.receivedWithEstimatedDate).toBe(1);
  });
  it("filtra por ano e por nome de ativo sem acentos", () => {
    const r = dividendReport(rows, { year: 2026, asset: "REALTY", today: "2026-10-31" });
    expect(r.received.net).toBe(20);
    expect(r.byAsset).toEqual([{ asset: "Realty Income", net: 20, gross: 25, count: 2 }]);
    expect(r.byMonth).toEqual([
      { month: "2026-03", net: 8 },
      { month: "2026-06", net: 12 },
    ]);
  });
  it("sem filtros soma todos os anos", () => {
    expect(dividendReport(rows, { today: "2026-10-31" }).received.net).toBe(23);
  });
});

describe("realizedReport", () => {
  const txs = [
    { type: "sell", traded_at: "2025-05-01", realized_pl: 100, asset_id: "a1" },
    { type: "sell", traded_at: "2026-02-01", realized_pl: -40, asset_id: "a2" },
    { type: "sell", traded_at: "2026-03-01", realized_pl: 15.5, asset_id: "a1" },
    { type: "buy", traded_at: "2026-03-02", realized_pl: null, asset_id: "a1" },
  ];
  const names = new Map([
    ["a1", "VWCE"],
    ["a2", "Apple"],
  ]);
  it("agrega por ano e por ativo, ignorando compras", () => {
    const r = realizedReport(txs, names, 2026);
    expect(r.total).toBe(-24.5);
    expect(r.sales).toBe(2);
    expect(r.byYear).toEqual([
      { year: "2025", realized: 100, sales: 1 },
      { year: "2026", realized: -24.5, sales: 2 },
    ]);
    expect(r.byAsset[0]).toEqual({ asset: "Apple", realized: -40, sales: 1 });
    expect(r.note).toMatch(/IRS/);
  });
  it("sem ano devolve o total de todos os anos", () => {
    expect(realizedReport(txs, names).total).toBe(75.5);
  });
});

describe("snapshotReport", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    snapshot_date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    market_value: 1000 + i * 10,
    invested_amount: 900,
  }));
  it("limita os pontos e mantém o primeiro e o último", () => {
    const r = snapshotReport(rows, "total", 10);
    expect(r.points).toBe(100);
    expect(r.series).toHaveLength(10);
    expect(r.series[0]!.date).toBe(rows[0]!.snapshot_date);
    expect(r.series[9]!.date).toBe(rows[99]!.snapshot_date);
    expect(r.marketValueChange).toBe(990);
    expect(r.marketValueChangePct).toBe(99);
  });
  it("sem dados devolve estrutura vazia", () => {
    const r = snapshotReport([], "total");
    expect(r).toMatchObject({ points: 0, first: null, last: null, marketValueChange: null });
  });
  it("ordena por data", () => {
    const r = snapshotReport(
      [
        { snapshot_date: "2026-02-01", market_value: 200, invested_amount: 100 },
        { snapshot_date: "2026-01-01", market_value: 100, invested_amount: 100 },
      ],
      "total",
    );
    expect(r.first!.date).toBe("2026-01-01");
    expect(r.marketValueChange).toBe(100);
  });
});
