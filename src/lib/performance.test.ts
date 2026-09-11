import { describe, expect, it } from "vitest";
import {
  buildLedgerSeries,
  cashFlowsFromLedger,
  contributionByAsset,
  drawdown,
  performanceByClass,
  periodPerformance,
  returnStats,
  twr,
  xirr,
  xirrFlows,
  type PerfTransaction,
} from "@/lib/performance";
import type { Asset } from "@/lib/portfolio-types";
import type { DividendRecord } from "@/lib/dividends";
import { periodRange } from "@/lib/dashboard";

const TODAY = "2026-09-10";
const ALL = periodRange("all", TODAY);

const asset = (p: Partial<Asset> & { id: string }): Asset =>
  ({
    user_id: "u",
    class: "etf",
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
  }) as Asset;

const buy = (
  traded_at: string,
  quantity: number,
  price: number,
  asset_id = "a",
  fee = 0,
): PerfTransaction => ({
  asset_id,
  type: "buy",
  traded_at,
  quantity,
  price,
  fee,
});
const sell = (
  traded_at: string,
  quantity: number,
  price: number,
  realized_pl: number,
  asset_id = "a",
): PerfTransaction => ({ asset_id, type: "sell", traded_at, quantity, price, fee: 0, realized_pl });

const div = (paid: string, amount: number, asset_id: string | null = "a"): DividendRecord => ({
  asset_id,
  asset_name: "A",
  amount,
  net_amount: amount,
  gross_amount: amount,
  payment_date: paid,
  paid_at: paid,
  status: "received",
});

describe("TWR", () => {
  it("carteira simples sem fluxos: retorno igual à valorização", () => {
    const r = twr([
      { date: "2026-01-01", value: 1000 },
      { date: "2026-06-30", value: 1200 },
    ]);
    expect(r.totalPct).toBeCloseTo(20, 10);
    expect(r.unavailable).toBeNull();
  });

  it("aportes em datas diferentes não distorcem o TWR", () => {
    // 1000 → 1100 (+10%), aporte de 1000 → 2100 → 2310 (+10%)
    const r = twr(
      [
        { date: "2026-01-01", value: 1000 },
        { date: "2026-06-30", value: 2100 },
        { date: "2026-12-31", value: 2310 },
      ],
      [{ date: "2026-06-30", amount: 1000 }],
    );
    expect(r.totalPct).toBeCloseTo(21, 8); // 1.1 × 1.1 − 1
  });

  it("levantamento é tratado como fluxo negativo", () => {
    const r = twr(
      [
        { date: "2026-01-01", value: 1000 },
        { date: "2026-06-30", value: 600 },
      ],
      [{ date: "2026-06-30", amount: -500 }],
    );
    expect(r.totalPct).toBeCloseTo(10, 8);
  });

  it("histórico insuficiente devolve indisponível", () => {
    expect(twr([{ date: "2026-01-01", value: 1000 }]).totalPct).toBeNull();
    expect(twr([]).unavailable).toBeTruthy();
  });
});

describe("MWR / XIRR", () => {
  it("aporte único duplicado em ~1 ano ≈ 100%", () => {
    const r = xirr([
      { date: "2025-09-10", amount: -1000 },
      { date: "2026-09-10", amount: 2000 },
    ]);
    expect(r.annualizedPct).toBeCloseTo(100, 1);
  });

  it("sem sinais opostos não é calculável", () => {
    expect(
      xirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2026-01-01", amount: -100 },
      ]).annualizedPct,
    ).toBeNull();
  });

  it("fluxos do ledger incluem dividendos e valor atual", () => {
    const flows = xirrFlows([buy("2025-09-10", 10, 100)], [div("2026-03-10", 50)], 1200, TODAY);
    expect(flows[0]).toEqual({ date: "2025-09-10", amount: -1000 });
    expect(flows.at(-1)).toEqual({ date: TODAY, amount: 1200 });
    expect(xirr(flows).annualizedPct).toBeGreaterThan(0);
  });
});

describe("séries do ledger", () => {
  it("compra e venda FIFO: realizado vem do ledger, sem duplicar capital", () => {
    const txs = [buy("2026-01-10", 10, 100), sell("2026-05-10", 4, 130, 120)];
    const s = buildLedgerSeries(txs, [], TODAY);
    expect(s).toHaveLength(2);
    expect(s[0]!.costBasis).toBe(1000);
    expect(s[1]!.realized).toBe(120);
    expect(s[1]!.costBasis).toBeCloseTo(600, 10); // custo das 6 restantes
    expect(s[1]!.netInvested).toBeCloseTo(480, 10);
  });

  it("dividendos entram na série sem alterar o capital investido", () => {
    const s = buildLedgerSeries([buy("2026-01-10", 10, 100)], [div("2026-06-10", 50)], TODAY);
    expect(s.at(-1)!.dividends).toBe(50);
    expect(s.at(-1)!.costBasis).toBe(1000);
  });

  it("histórico vazio devolve série vazia", () => {
    expect(buildLedgerSeries([], [], TODAY)).toEqual([]);
    expect(cashFlowsFromLedger([])).toEqual([]);
  });
});

describe("drawdown", () => {
  it("máximo e atual sobre série real", () => {
    const d = drawdown([
      { date: "2026-01-01", value: 100 },
      { date: "2026-02-01", value: 120 },
      { date: "2026-03-01", value: 90 },
      { date: "2026-04-01", value: 110 },
    ]);
    expect(d.maxPct).toBeCloseTo(-25, 10);
    expect(d.maxFrom).toBe("2026-02-01");
    expect(d.maxTo).toBe("2026-03-01");
    expect(d.currentPct).toBeCloseTo(-8.3333, 3);
  });

  it("série insuficiente não inventa valores", () => {
    expect(drawdown([{ date: "2026-01-01", value: 100 }]).maxPct).toBeNull();
  });
});

describe("estatísticas de períodos", () => {
  it("não apresenta métricas com poucas observações", () => {
    const s = returnStats([{ from: "a", to: "b", r: 0.1 }]);
    expect(s.bestPct).toBeNull();
    expect(s.unavailable).toBeTruthy();
  });

  it("melhor/pior, média de ganhos e taxa de positivos", () => {
    const s = returnStats(
      [0.1, -0.05, 0.2, -0.1].map((r, i) => ({ from: `d${i}`, to: `d${i + 1}`, r })),
    );
    expect(s.bestPct).toBeCloseTo(20, 10);
    expect(s.worstPct).toBeCloseTo(-10, 10);
    expect(s.positiveRatePct).toBe(50);
    expect(s.volatilityPct).toBeNull(); // < 6 observações
  });
});

describe("contribuição e classes", () => {
  const assets = [
    asset({
      id: "a",
      name: "ETF World",
      class: "etf",
      quantity: 10,
      average_price: 100,
      current_price: 120,
    }),
    asset({
      id: "b",
      name: "Prata",
      class: "metal",
      quantity: 100,
      average_price: 1,
      current_price: 1.2,
    }),
    asset({ id: "c", name: "P2P", class: "p2p", invested_amount: 500, current_value: 550 }),
  ];
  const txs = [buy("2026-01-10", 10, 100, "a"), sell("2026-05-10", 2, 150, 100, "a")];
  const divs = [div("2026-06-10", 40, "a")];

  it("separa valorização, realização e dividendos por ativo", () => {
    const rows = contributionByAsset(assets, txs, divs, ALL, TODAY);
    const etf = rows.find((r) => r.assetId === "a")!;
    expect(etf.appreciation).toBeCloseTo(200, 10);
    expect(etf.realized).toBe(100);
    expect(etf.dividends).toBe(40);
    expect(etf.total).toBeCloseTo(340, 10);
  });

  it("múltiplos ativos e classes", () => {
    const rows = performanceByClass(assets, divs, ALL, TODAY);
    expect(rows.map((r) => r.class).sort()).toEqual(["etf", "metal", "p2p"]);
    const metal = rows.find((r) => r.class === "metal")!;
    expect(metal.unrealized).toBeCloseTo(20, 10);
    const p2p = rows.find((r) => r.class === "p2p")!;
    expect(p2p.unrealized).toBeCloseTo(50, 10);
  });

  it("dividendos não são contados duas vezes no resultado do período", () => {
    const p = periodPerformance(assets, txs, divs, ALL, [], TODAY);
    expect(p.dividends).toBe(40);
    expect(p.absolute).toBeCloseTo(p.unrealized + p.realized + p.dividends, 10);
  });

  it("período sem dados: sem retorno e sem TWR", () => {
    const p = periodPerformance([], [], [], periodRange("today", TODAY), [], TODAY);
    expect(p.absolute).toBe(0);
    expect(p.simplePct).toBeNull();
    expect(p.twr.totalPct).toBeNull();
    expect(p.mwr.annualizedPct).toBeNull();
  });

  it("gaps de preço/FX: ativo sem cotação não inventa valorização", () => {
    const semPreco = [asset({ id: "x", quantity: 5, average_price: 50, current_price: 0 })];
    const rows = performanceByClass(semPreco, [], ALL, TODAY);
    expect(rows[0]!.value).toBe(0);
    expect(rows[0]!.unrealized).toBeCloseTo(-250, 10);
  });
});

describe("ausência de LLM", () => {
  it("o módulo de performance não faz chamadas externas", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/performance.ts", "utf8"),
    );
    expect(src).not.toMatch(/fetch\(|openai|gateway|anthropic|gemini|ai\.lovable/i);
  });
});
