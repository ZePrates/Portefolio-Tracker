import { describe, expect, it } from "vitest";
import { dwsAssetClass, parseDwsGrid } from "./dws.ts";

// Excerto do Excel real do Xtrackers MSCI World Value (IE00BL25JM42), 15/10/2026.
const HEAD = [null, "Name", "ISIN", "Country", "Currency", "Exchange", "Type of Security", "Rating", "Primary Listing", "Industry Classification", "Weighting"];
const grid = [
  ["Although information in this document has been obtained from sources believed to be reliable…"],
  HEAD,
  ["1", "MICRON TECHNOLOGY", "US5951121038", "United States", "USD", "NASDAQ National Market System", "Equities", "Ba3", "NASDAQ Composite Index", "Information Technology", 0.6],
  ["2", "TOYOTA MOTOR", "JP3633400001", "Japan", "JPY", "Tokyo Stock Exchange", "Equities", "Aa3", "TOPIX Index", "Consumer Discretionary", 0.3],
  ["3", "SAMSUNG ELECTRONICS GDR", "US7960508882", "South Korea", "USD", "London Stock Exchange", "Depository Receipts", "-", "-", "Information Technology", 0.05],
  ["4", "SOME CO RTS", "SE0012345678", "Sweden", "SEK", "-", "Right", "-", "-", "Industrials", 0.01],
  ["5", "US DOLLAR", "_CURRENCYUSD", "United States", "USD", "-", "Cash", "-", "-", "unknown", 0.04],
  ["6", "MSCI WORLD INDEX  DEC26", "___ADI2VD0J5", "Germany", "USD", "-", "Future", "-", "-", "unknown", "N/A"],
];

describe("parseDwsGrid", () => {
  const { rows } = parseDwsGrid(grid, "2026-10-15");
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

  it("classifica 'Equities' como ação (era gravado como dinheiro)", () => {
    expect(byName["MICRON TECHNOLOGY"].asset_class).toBe("Equity");
    expect(byName["TOYOTA MOTOR"].asset_class).toBe("Equity");
    expect(byName["MICRON TECHNOLOGY"].isin).toBe("US5951121038");
  });

  it("recibos de depósito e direitos com ISIN contam como ação", () => {
    expect(byName["SAMSUNG ELECTRONICS GDR"].asset_class).toBe("Equity");
    expect(byName["SOME CO RTS"].asset_class).toBe("Equity");
  });

  it("dinheiro fica como dinheiro e sem o código interno no ISIN", () => {
    expect(byName["US DOLLAR"]).toMatchObject({ asset_class: "Cash and/or Derivatives", isin: null, exchange: null });
  });

  it("ignora futuros com peso 'N/A'", () => {
    expect(byName["MSCI WORLD INDEX  DEC26"]).toBeUndefined();
    expect(rows).toHaveLength(5);
  });

  it("mantém pesos em fração e lê setor/país", () => {
    expect(byName["MICRON TECHNOLOGY"]).toMatchObject({ weight: 0.6, sector: "Information Technology", country: "United States", currency: "USD" });
  });

  it("converte pesos em percentagem para fração", () => {
    const pct = parseDwsGrid([HEAD, [null, "A", "US0000000001", null, null, null, "Equities", null, null, null, "60%"], [null, "B", "US0000000002", null, null, null, "Equities", null, null, null, "40,0"]]);
    expect(pct.rows.map((r) => r.weight)).toEqual([0.6, 0.4]);
  });

  it("rejeita um Excel sem cabeçalho reconhecível", () => {
    expect(() => parseDwsGrid([["foo", "bar"]])).toThrow(/não reconhecido/);
  });
});

describe("dwsAssetClass", () => {
  it("sem tipo, decide pelo ISIN", () => {
    expect(dwsAssetClass(null, "US5951121038")).toBe("Equity");
    expect(dwsAssetClass(null, null)).toBe("Cash and/or Derivatives");
  });
  it("derivados e câmbio nunca são ações, mesmo com ISIN", () => {
    for (const t of ["Future", "FX Forward", "Swap", "Cash", "Option"]) expect(dwsAssetClass(t, "US5951121038")).toBe("Cash and/or Derivatives");
  });
});
