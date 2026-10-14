import { describe, expect, it } from "vitest";
import { analyzePurchase } from "@/lib/decision";
import type { PositionInput } from "@/lib/exposure-types";
import type { AssetClass } from "@/lib/portfolio-types";

const a = (id: string, value: number, cls: AssetClass, name = id) => ({
  id,
  user_id: "u",
  class: cls,
  name,
  ticker: null,
  isin: null,
  quantity: 1,
  average_price: value,
  current_price: value,
  invested_amount: value,
  current_value: value,
  currency: "EUR",
  metal_type: null,
  p2p_group: null,
  annual_yield: null,
  notes: null,
  native_currency: "EUR",
  purchase_price_native: value,
  current_price_native: value,
  dividend_frequency: null,
  last_dividend_import: null,
  status: "open",
  realized_pl: 0,
  total_fees: 0,
  closed_at: null,
  created_at: "",
  updated_at: "",
});

const pos = (over: Partial<PositionInput> & { assetId: string; value: number }): PositionInput => ({
  name: over.assetId,
  class: "etf",
  ticker: null,
  nativeCurrency: "EUR",
  exposures: [],
  holdings: [],
  ...over,
});

/** ETF com 40 empresas iguais (2,5 % cada). */
const diversified = Array.from({ length: 40 }, (_, i) => ({
  name: `Empresa ${i}`,
  symbol: `E${i}`,
  weight: 1 / 40,
  country: "US",
  sector: "Tech",
}));

describe("simulador de compra", () => {
  it("compara a alocação antes e depois", () => {
    const r = analyzePurchase([a("A", 800, "etf"), a("B", 200, "reit")], {
      amount: 100,
      assetClass: "reit",
      name: "B",
    });
    expect(r.proposedTotal).toBe(1100);
    expect(r.allocation.find((x) => x.class === "reit")?.proposedPct).toBeCloseTo(27.27, 1);
  });

  it("reforçar um ETF diversificado não gera alertas, mesmo com a classe acima de 40 %", () => {
    const assets = [a("VWCE", 900, "etf"), a("O", 100, "reit", "Realty Income")];
    const positions = [
      pos({ assetId: "VWCE", value: 900, holdings: diversified }),
      pos({ assetId: "O", name: "Realty Income", class: "reit", value: 100 }),
    ];
    const r = analyzePurchase(
      assets,
      { amount: 500, assetClass: "etf", assetId: "VWCE", name: "VWCE" },
      { positions },
    );
    expect(r.lookThrough).toBe(true);
    expect(r.allocation.find((x) => x.class === "etf")!.proposedPct).toBeGreaterThan(90);
    expect(r.alerts).toEqual([]);
    // A Realty Income dilui-se: a maior exposição a uma empresa desce.
    expect(r.after.largestCompanyPct).toBeLessThan(r.before.largestCompanyPct);
  });

  it("avisa quando a compra junta uma ação à mesma empresa dentro do ETF", () => {
    const assets = [a("VWCE", 900, "etf"), a("MSFT", 100, "acao_crescimento", "Microsoft")];
    const positions = [
      pos({
        assetId: "VWCE",
        value: 900,
        holdings: [
          { name: "Microsoft Corp", symbol: "MSFT", weight: 0.05, country: "US", sector: "Tech" },
          ...diversified.slice(0, 38).map((h) => ({ ...h, weight: 0.95 / 38 })),
        ],
      }),
      pos({ assetId: "MSFT", name: "Microsoft", class: "acao_crescimento", value: 100 }),
    ];
    const r = analyzePurchase(
      assets,
      { amount: 300, assetClass: "acao_crescimento", assetId: "MSFT", name: "Microsoft" },
      { positions },
    );
    // Antes: (45 + 100) / 1000 = 14,5 %; depois: (45 + 400) / 1300 ≈ 34,2 %.
    expect(r.before.largestCompanyPct).toBeCloseTo(14.5, 1);
    expect(r.after.largestCompanyPct).toBeCloseTo(34.23, 1);
    expect(r.alerts.some((x) => x.includes("Microsoft"))).toBe(true);
  });

  it("sem composição dos ETFs, cada posição conta como uma empresa", () => {
    const r = analyzePurchase([a("A", 900, "acao_crescimento"), a("B", 100, "reit")], {
      amount: 500,
      assetClass: "acao_crescimento",
      assetId: "A",
      name: "A",
    });
    expect(r.lookThrough).toBe(false);
    expect(r.after.largestCompanyPct).toBeCloseTo(93.33, 1);
    expect(r.alerts.length).toBeGreaterThan(0);
  });

  it("um ETF novo, ainda sem composição, não conta como uma empresa", () => {
    const r = analyzePurchase([a("A", 500, "acao_crescimento"), a("B", 500, "reit")], {
      amount: 1000,
      assetClass: "etf",
      name: "ETF novo",
    });
    expect(r.after.largestCompanyPct).toBeCloseTo(25, 1);
    expect(r.alerts).toEqual([]);
  });

  it("só compara classes com alvos quando estão definidos", () => {
    const assets = [a("VWCE", 600, "etf"), a("O", 400, "reit")];
    const sem = analyzePurchase(assets, {
      amount: 400,
      assetClass: "reit",
      name: "O",
      assetId: "O",
    });
    expect(sem.hasTargets).toBe(false);
    expect(sem.allocation.every((x) => x.targetPct === null)).toBe(true);

    const targets = [
      { key: "etf", targetPct: 80 },
      { key: "reit", targetPct: 20 },
    ];
    const afasta = analyzePurchase(
      assets,
      { amount: 400, assetClass: "reit", name: "O", assetId: "O" },
      { targets },
    );
    expect(afasta.hasTargets).toBe(true);
    expect(afasta.alerts.some((x) => x.startsWith("REITs ficaria"))).toBe(true);

    const aproxima = analyzePurchase(
      assets,
      { amount: 400, assetClass: "etf", name: "VWCE", assetId: "VWCE" },
      { targets },
    );
    expect(aproxima.notes.some((x) => x.includes("aproxima ETFs do alvo"))).toBe(true);
  });

  it("um ativo existente fixa a classe, mesmo que a proposta traga outra", () => {
    const r = analyzePurchase([a("VWCE", 800, "etf"), a("O", 200, "reit")], {
      amount: 200,
      assetClass: "reit",
      assetId: "VWCE",
      name: "VWCE",
    });
    expect(r.allocation.find((x) => x.class === "etf")!.proposedValue).toBe(1000);
    expect(r.allocation.find((x) => x.class === "reit")!.proposedValue).toBe(200);
  });

  it("pede um montante positivo", () => {
    const r = analyzePurchase([a("A", 100, "etf")], { amount: 0, assetClass: "etf", name: "A" });
    expect(r.alerts).toContain("Indica um montante de compra superior a zero.");
  });
});
