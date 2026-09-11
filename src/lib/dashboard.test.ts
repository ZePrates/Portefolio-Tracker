import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  portfolioSummary,
  allocationByClass,
  assetPerformance,
  bestPerformers,
  worstPerformers,
  buildTimeline,
  dividendSummary,
  periodRange,
  realizedInRange,
} from "@/lib/dashboard";
import type { Asset } from "@/lib/portfolio-types";
import type { DividendRecord } from "@/lib/dividends";

const TODAY = "2026-09-06";

function asset(p: Partial<Asset> & { id: string }): Asset {
  return {
    user_id: "u",
    class: "acao_dividendo",
    ticker: null,
    name: p.id,
    quantity: 0,
    average_price: 0,
    current_price: 0,
    invested_amount: 0,
    current_value: 0,
    currency: "EUR",
    metal_type: null,
    p2p_group: null,
    annual_yield: null,
    notes: null,
    native_currency: "EUR",
    purchase_price_native: null,
    current_price_native: null,
    dividend_frequency: null,
    last_dividend_import: null,
    status: "open",
    realized_pl: 0,
    total_fees: 0,
    closed_at: null,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    ...p,
  } as Asset;
}

function div(p: Partial<DividendRecord>): DividendRecord {
  return {
    asset_id: null,
    asset_name: "X",
    amount: 0,
    paid_at: "2026-01-01",
    ...p,
  } as DividendRecord;
}

const AAPL = asset({
  id: "aapl",
  name: "Apple",
  ticker: "AAPL",
  quantity: 10,
  average_price: 100,
  current_price: 150,
  realized_pl: 200,
});
const ETF = asset({
  id: "etf",
  name: "VWCE",
  class: "etf",
  quantity: 20,
  average_price: 100,
  current_price: 90,
});
const SILVER = asset({
  id: "ag",
  name: "Prata",
  class: "metal",
  metal_type: "silver",
  quantity: 1000,
  average_price: 0.8,
  current_price: 1,
  native_currency: "USD",
  current_price_native: 1.1,
});
const P2P = asset({
  id: "p2p",
  name: "Scramble",
  class: "p2p",
  invested_amount: 500,
  current_value: 560,
});
const CLOSED = asset({
  id: "closed",
  name: "Vendida",
  status: "closed",
  quantity: 0,
  invested_amount: 1000,
  realized_pl: 150,
});

const ASSETS = [AAPL, ETF, SILVER, P2P, CLOSED];

const DIVS: DividendRecord[] = [
  div({
    asset_id: "aapl",
    asset_name: "Apple",
    amount: 100,
    net_amount: 80,
    payment_date: "2026-03-10",
    paid_at: "2026-03-10",
    status: "received",
  }),
  div({
    asset_id: "aapl",
    asset_name: "Apple",
    amount: 100,
    net_amount: 80,
    payment_date: "2026-09-01",
    paid_at: "2026-09-01",
    status: "received",
  }),
  div({
    asset_id: "etf",
    asset_name: "VWCE",
    amount: 50,
    net_amount: 50,
    payment_date: "2026-12-01",
    paid_at: "2026-12-01",
    status: "scheduled",
  }),
];

describe("KPIs do dashboard", () => {
  const s = portfolioSummary(ASSETS, DIVS, TODAY);

  it("valor total soma apenas posições abertas (inclui prata e P2P)", () => {
    // 1500 + 1800 + 1000 + 560
    expect(s.currentValue).toBeCloseTo(4860, 6);
    expect(s.openPositions).toBe(4);
    expect(s.closedPositions).toBe(1);
  });

  it("cost basis usa o custo das unidades ainda detidas", () => {
    expect(s.costBasis).toBeCloseTo(1000 + 2000 + 800 + 500, 6);
  });

  it("separa realizado de não realizado", () => {
    expect(s.realizedPL).toBeCloseTo(350, 6);
    expect(s.unrealizedPL).toBeCloseTo(4860 - 4300, 6);
  });

  it("dividendos recebidos usam o líquido e excluem agendados (sem dupla contagem)", () => {
    expect(s.dividendsReceived).toBeCloseTo(160, 6);
    expect(s.dividendsScheduled).toBeCloseTo(50, 6);
  });

  it("resultado total = realizado + não realizado + dividendos recebidos", () => {
    expect(s.totalResult).toBeCloseTo(350 + 560 + 160, 6);
    expect(s.returnBasis).toBeCloseTo(4300 + 1000, 6);
    expect(s.totalReturnPct).toBeCloseTo((1070 / 5300) * 100, 6);
  });

  it("estado sem dados devolve zeros e rentabilidade nula", () => {
    const empty = portfolioSummary([], [], TODAY);
    expect(empty.currentValue).toBe(0);
    expect(empty.totalReturnPct).toBeNull();
    expect(empty.yieldOnCost).toBeNull();
  });
});

describe("alocação e performance", () => {
  it("aloca por classe apenas com classes existentes", () => {
    const alloc = allocationByClass(ASSETS);
    const labels = alloc.map((a) => a.class);
    expect(labels).toContain("metal");
    expect(labels).toContain("p2p");
    expect(labels).not.toContain("reit");
    const total = alloc.reduce((s, a) => s + a.value, 0);
    expect(total).toBeCloseTo(4860, 6);
    expect(alloc.reduce((s, a) => s + a.pct, 0)).toBeCloseTo(100, 6);
  });

  it("ativos totalmente vendidos não entram na alocação nem na performance", () => {
    expect(assetPerformance(ASSETS).some((r) => r.id === "closed")).toBe(false);
  });

  it("melhores e piores desempenhos usam o custo real do investidor", () => {
    const rows = assetPerformance(ASSETS);
    expect(bestPerformers(rows, 1)[0]!.id).toBe("aapl"); // +50%
    expect(worstPerformers(rows, 1)[0]!.id).toBe("etf"); // -10%
    const weights = rows.reduce((s, r) => s + r.weight, 0);
    expect(weights).toBeCloseTo(100, 6);
  });

  it("prata em moeda estrangeira usa o valor já convertido em EUR", () => {
    const ag = assetPerformance(ASSETS).find((r) => r.id === "ag")!;
    expect(ag.value).toBeCloseTo(1000, 6);
    expect(ag.unrealizedPct).toBeCloseTo(25, 6);
  });
});

describe("filtros temporais", () => {
  it("calcula intervalos coerentes", () => {
    expect(periodRange("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(periodRange("month", TODAY).from).toBe("2026-09-01");
    expect(periodRange("ytd", TODAY).from).toBe("2026-01-01");
    expect(periodRange("1y", TODAY).from).toBe("2025-09-06");
    expect(periodRange("custom", TODAY, { from: "2026-02-01", to: "2026-02-28" }).to).toBe(
      "2026-02-28",
    );
  });

  it("dividendos do período respeitam o intervalo", () => {
    const ytd = dividendSummary(DIVS, periodRange("ytd", TODAY), TODAY);
    expect(ytd.period).toBeCloseTo(160, 6);
    expect(ytd.scheduled).toBeCloseTo(50, 6);
    const mes = dividendSummary(DIVS, periodRange("month", TODAY), TODAY);
    expect(mes.period).toBeCloseTo(80, 6);
    expect(mes.byMonth.length).toBe(2);
    expect(mes.byAsset[0]!.assetName).toBe("Apple");
  });

  it("realizado no período vem do ledger de vendas", () => {
    const txs = [
      { type: "sell", traded_at: "2026-02-10", realized_pl: 100 },
      { type: "sell", traded_at: "2025-02-10", realized_pl: 999 },
      { type: "buy", traded_at: "2026-02-10", realized_pl: null },
    ];
    expect(realizedInRange(txs, periodRange("ytd", TODAY))).toBeCloseTo(100, 6);
  });
});

describe("evolução temporal", () => {
  const txs = [
    { type: "buy", traded_at: "2026-01-10", quantity: 10, price: 100, fee: 5 },
    { type: "sell", traded_at: "2026-03-10", quantity: 5, price: 120, fee: 0, realized_pl: 100 },
  ];

  it("acumula fluxos reais sem inventar valores de mercado", () => {
    const pts = buildTimeline(txs, DIVS, periodRange("ytd", TODAY), "month", TODAY);
    expect(pts.map((p) => p.key)).toEqual(["2026-01", "2026-03", "2026-09"]);
    expect(pts[0]!.invested).toBeCloseTo(1005, 6);
    expect(pts[1]!.invested).toBeCloseTo(1005 - 500, 6);
    expect(pts[1]!.realized).toBeCloseTo(100, 6);
    expect(pts[2]!.dividends).toBeCloseTo(160, 6);
  });

  it("sem movimentos devolve série vazia", () => {
    expect(buildTimeline([], [], periodRange("all", TODAY), "month", TODAY)).toEqual([]);
  });
});

describe("garantias estruturais", () => {
  const dashboard = readFileSync("src/lib/dashboard.ts", "utf8");
  const page = readFileSync("src/routes/_authenticated/index.tsx", "utf8");

  it("não usa LLM/AI para métricas financeiras", () => {
    for (const src of [dashboard, page]) {
      expect(/openai|gemini|lovable-ai|ai\.gateway|generateText/i.test(src)).toBe(false);
    }
  });

  it("o dashboard não lista todos os ativos", () => {
    expect(page.includes("AssetClassPage")).toBe(false);
    expect(/assets\.map\(/.test(page)).toBe(false);
  });
});
