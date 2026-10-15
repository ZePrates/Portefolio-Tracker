import { describe, expect, it } from "vitest";
import { rebuildHistory, type PriceHistory, type RebuildRow } from "@/lib/history-rebuild";
import { TROY_OUNCE_GRAMS } from "@/lib/prices";

const row = (rows: RebuildRow[], date: string, scope = "total") =>
  rows.find((r) => r.date === date && r.scope === scope);

const eur = (points: Array<[string, number]>): PriceHistory => ({
  currency: "EUR",
  factor: 1,
  points: points.map(([date, value]) => ({ date, value })),
});

describe("rebuildHistory", () => {
  it("avalia unidades ao fecho do dia e repete o último fecho no fim de semana", () => {
    const r = rebuildHistory({
      assets: [{ id: "a", class: "etf", name: "VWCE", symbol: "VWCE.DE" }],
      transactions: [
        {
          assetId: "a",
          type: "buy",
          date: "2026-10-09",
          quantity: 2,
          total: 200,
          realizedPl: null,
        },
      ],
      prices: new Map([
        [
          "VWCE.DE",
          eur([
            ["2026-10-09", 101],
            ["2026-10-12", 105],
          ]),
        ],
      ]),
      fx: new Map(),
      to: "2026-10-12",
    });
    expect(r.from).toBe("2026-10-09");
    expect(row(r.rows, "2026-10-09")).toEqual({
      date: "2026-10-09",
      scope: "total",
      invested: 200,
      value: 202,
    });
    expect(row(r.rows, "2026-10-11")?.value).toBe(202); // domingo
    expect(row(r.rows, "2026-10-12")?.value).toBe(210);
    expect(row(r.rows, "2026-10-12", "class:etf")?.value).toBe(210);
    expect(r.atCost).toEqual([]);
  });

  it("converte pelo câmbio do dia e aplica o factor dos cêntimos", () => {
    const r = rebuildHistory({
      assets: [
        { id: "u", class: "reit", name: "O", symbol: "O" },
        { id: "g", class: "etf", name: "GBX", symbol: "X.L" },
      ],
      transactions: [
        {
          assetId: "u",
          type: "buy",
          date: "2026-01-02",
          quantity: 10,
          total: 450,
          realizedPl: null,
        },
        { assetId: "g", type: "buy", date: "2026-01-02", quantity: 1, total: 11, realizedPl: null },
      ],
      prices: new Map([
        ["O", { currency: "USD", factor: 1, points: [{ date: "2026-01-02", value: 50 }] }],
        ["X.L", { currency: "GBP", factor: 0.01, points: [{ date: "2026-01-02", value: 1000 }] }],
      ]),
      fx: new Map([
        ["USD", [{ date: "2026-01-02", value: 0.9 }]],
        ["GBP", [{ date: "2026-01-02", value: 1.2 }]],
      ]),
      to: "2026-01-02",
    });
    expect(row(r.rows, "2026-01-02", "class:reit")?.value).toBe(450);
    expect(row(r.rows, "2026-01-02", "class:etf")?.value).toBe(12);
    expect(row(r.rows, "2026-01-02")?.value).toBe(462);
  });

  it("sem fecho histórico, avalia ao preço da última compra e avisa", () => {
    const r = rebuildHistory({
      assets: [{ id: "a", class: "etf", name: "Novo ETF", symbol: "NEW.DE" }],
      transactions: [
        { assetId: "a", type: "buy", date: "2026-03-01", quantity: 4, total: 40, realizedPl: null },
      ],
      prices: new Map([["NEW.DE", eur([["2026-03-03", 12]])]]),
      fx: new Map(),
      to: "2026-03-03",
    });
    expect(row(r.rows, "2026-03-01")?.value).toBe(40);
    expect(row(r.rows, "2026-03-03")?.value).toBe(48);
    expect(r.atCost).toEqual(["Novo ETF"]);
  });

  it("venda: tira as unidades e o custo (valor − mais-valia)", () => {
    const r = rebuildHistory({
      assets: [{ id: "a", class: "acao_crescimento", name: "X", symbol: "X" }],
      transactions: [
        {
          assetId: "a",
          type: "buy",
          date: "2026-01-01",
          quantity: 10,
          total: 100,
          realizedPl: null,
        },
        { assetId: "a", type: "sell", date: "2026-01-02", quantity: 4, total: 60, realizedPl: 20 },
      ],
      prices: new Map([["X", eur([["2026-01-01", 15]])]]),
      fx: new Map(),
      to: "2026-01-02",
    });
    expect(row(r.rows, "2026-01-02")).toMatchObject({ invested: 60, value: 90 });
  });

  it("metal: gramas menos taxas em gramas, ao preço de recompra", () => {
    const spotUsdOz = TROY_OUNCE_GRAMS * 2; // 2 USD/g
    const r = rebuildHistory({
      assets: [{ id: "m", class: "metal", name: "Prata", symbol: "SI=F", buybackDiscount: 0.03 }],
      transactions: [
        {
          assetId: "m",
          type: "buy",
          date: "2026-01-01",
          quantity: 100,
          total: 220,
          realizedPl: null,
        },
      ],
      gramDeductions: [{ assetId: "m", date: "2026-01-02", grams: 10 }],
      prices: new Map([
        [
          "SI=F",
          { currency: "USD", factor: 1, points: [{ date: "2026-01-01", value: spotUsdOz }] },
        ],
      ]),
      fx: new Map([["USD", [{ date: "2026-01-01", value: 0.5 }]]]),
      to: "2026-01-02",
    });
    // 100 g × 2 USD × 0,5 × 0,97 = 97; depois 90 g = 87,3. O investido não muda.
    expect(row(r.rows, "2026-01-01")).toMatchObject({ invested: 220, value: 97 });
    expect(row(r.rows, "2026-01-02")).toMatchObject({ invested: 220, value: 87.3 });
  });

  it("P2P: compras de créditos e reembolsos não mudam o valor; juros e bónus sim", () => {
    const r = rebuildHistory({
      assets: [{ id: "p", class: "p2p", name: "Scramble", symbol: null }],
      transactions: [],
      p2pCash: [
        { assetId: "p", date: "2026-04-07", type: "deposit", amount: 100 },
        { assetId: "p", date: "2026-04-17", type: "purchase", amount: -100 },
        { assetId: "p", date: "2026-05-05", type: "principal", amount: 6 },
        { assetId: "p", date: "2026-10-05", type: "interest", amount: 5.8 },
        { assetId: "p", date: "2026-10-05", type: "bonus_noncash", amount: 5 },
      ],
      prices: new Map(),
      fx: new Map(),
      to: "2026-10-05",
    });
    expect(r.from).toBe("2026-04-07");
    expect(row(r.rows, "2026-05-05", "class:p2p")).toMatchObject({ invested: 100, value: 100 });
    expect(row(r.rows, "2026-10-05", "class:p2p")).toMatchObject({ invested: 100, value: 110.8 });
  });

  it("sem movimentos não devolve linhas", () => {
    const r = rebuildHistory({
      assets: [],
      transactions: [],
      prices: new Map(),
      fx: new Map(),
      to: "2026-10-14",
    });
    expect(r.rows).toEqual([]);
    expect(r.from).toBeNull();
  });
});
