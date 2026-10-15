import { describe, expect, it } from "vitest";
import { defaultCloseMonth, monthClose, shiftMonth, type MonthCloseInput } from "./month-close";

const assets: MonthCloseInput["assets"] = [
  { id: "vwce", name: "Vanguard All-World", ticker: "VWCE", class: "etf" },
  { id: "o", name: "Realty Income", ticker: "O", class: "reit" },
  { id: "ag", name: "Prata", ticker: null, class: "metal" },
  { id: "scr", name: "Scramble", ticker: null, class: "p2p" },
];

const div = (over: Partial<MonthCloseInput["dividends"][number]>) => ({
  asset_id: "o",
  asset_name: "Realty Income",
  payment_date: "2026-09-15",
  paid_at: "2026-09-15",
  source: "xtb",
  payment_date_estimated: false,
  net_amount: 0.8,
  amount: 0.94,
  ...over,
});

const base: MonthCloseInput = {
  month: "2026-09",
  today: "2026-10-15",
  assets,
  transactions: [],
  dividends: [],
  p2pMovements: [],
};

describe("monthClose", () => {
  it("mês fechado: tudo veio do extrato, Elementum e Scramble registadas", () => {
    const r = monthClose({
      ...base,
      transactions: [
        { asset_id: "vwce", type: "buy", traded_at: "2026-09-03", source: "xtb", fee: 0 },
        { asset_id: "ag", type: "buy", traded_at: "2026-09-10", source: "elementum", fee: 1.2 },
      ],
      dividends: [div({})],
      p2pMovements: [{ occurred_on: "2026-09-20", type: "purchase" }],
    });
    expect(r.steps.map((s) => [s.key, s.done])).toEqual([
      ["xtb", true],
      ["dividends", true],
      ["elementum", true],
      ["scramble", true],
    ]);
    expect(r.doneCount).toBe(4);
    expect(r.dividendsNet).toBeCloseTo(0.8);
  });

  it("lista movimentos à mão e dividendos estimados por confirmar", () => {
    const r = monthClose({
      ...base,
      transactions: [
        { asset_id: "vwce", type: "buy", traded_at: "2026-09-21", source: "manual", fee: 0 },
        // Mês seguinte: não conta.
        { asset_id: "vwce", type: "buy", traded_at: "2026-10-01", source: "manual", fee: 0 },
      ],
      dividends: [
        div({ source: "yahoo", payment_date: "2026-09-30", payment_date_estimated: true }),
        // Ainda não pago: não conta.
        div({ source: "yahoo", payment_date: "2026-10-30", paid_at: null }),
      ],
    });
    const xtb = r.steps.find((s) => s.key === "xtb")!;
    expect(xtb.done).toBe(false);
    expect(xtb.pending).toEqual(["VWCE · 21/09 · compra"]);
    const dividends = r.steps.find((s) => s.key === "dividends")!;
    expect(dividends.done).toBe(false);
    expect(dividends.pending).toEqual(["O · 30/09 · data estimada"]);
    expect(r.steps.find((s) => s.key === "elementum")!.done).toBe(false);
    expect(r.steps.find((s) => s.key === "scramble")!.done).toBe(false);
  });

  it("sem nada do extrato no mês, o passo XTB fica por fazer", () => {
    const r = monthClose(base);
    expect(r.steps.find((s) => s.key === "xtb")!.done).toBe(false);
  });

  it("só mostra os passos das classes que tens", () => {
    const r = monthClose({ ...base, assets: [assets[0]!] });
    expect(r.steps.map((s) => s.key)).toEqual(["xtb", "dividends"]);
  });
});

describe("meses", () => {
  it("nos primeiros 10 dias fecha o mês anterior", () => {
    expect(defaultCloseMonth("2026-11-05")).toBe("2026-10");
    expect(defaultCloseMonth("2026-10-15")).toBe("2026-10");
    expect(defaultCloseMonth("2026-01-03")).toBe("2025-12");
  });

  it("shiftMonth atravessa o ano", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
