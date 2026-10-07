import { describe, expect, it } from "vitest";
import { toYahooSymbol, yahooSymbolFor } from "./yahoo";

describe("toYahooSymbol", () => {
  it("converte os sufixos de bolsa do Base44", () => {
    expect(toYahooSymbol("O.US")).toBe("O");
    expect(toYahooSymbol("VUSA.UK")).toBe("VUSA.L");
    expect(toYahooSymbol(" ")).toBeNull();
  });
});

describe("yahooSymbolFor", () => {
  it("usa o símbolo com bolsa do price_source", () => {
    expect(yahooSymbolFor({ ticker: "VWCE", price_source: "yahoo:VWCE.DE" })).toBe("VWCE.DE");
    expect(yahooSymbolFor({ ticker: "INRA", price_source: "yahoo:INRA.AS" })).toBe("INRA.AS");
  });

  it("cai no ticker quando não há price_source Yahoo", () => {
    expect(yahooSymbolFor({ ticker: "O.US", price_source: null })).toBe("O");
    expect(yahooSymbolFor({ ticker: "AAPL", price_source: "manual" })).toBe("AAPL");
    expect(yahooSymbolFor({ ticker: "AAPL", price_source: "yahoo:" })).toBe("AAPL");
    expect(yahooSymbolFor({ ticker: null, price_source: null })).toBeNull();
  });
});
