import { describe, expect, it } from "vitest";
import { parseYahooHistory, toYahooSymbol, yahooSymbolFor } from "./yahoo";

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

describe("parseYahooHistory", () => {
  it("data no fuso da bolsa: o câmbio das 23:00 UTC conta para o dia seguinte", () => {
    const h = parseYahooHistory({
      chart: {
        result: [
          {
            meta: { currency: "EUR", exchangeTimezoneName: "Europe/London" },
            timestamp: [1760050800, 1760310000], // 23:00 UTC de 09/10 e 12/10/2025
            indicators: { quote: [{ close: [0.892, 0.896] }] },
          },
        ],
      },
    });
    expect(h?.points.map((p) => p.date)).toEqual(["2025-10-10", "2025-10-13"]);
  });

  it("ignora fechos vazios e normaliza os cêntimos de libra", () => {
    const h = parseYahooHistory({
      chart: {
        result: [
          {
            meta: { currency: "GBp", exchangeTimezoneName: "Europe/London" },
            timestamp: [1760083200, 1760169600],
            indicators: { quote: [{ close: [null, 1250] }] },
          },
        ],
      },
    });
    expect(h).toEqual({
      currency: "GBP",
      factor: 0.01,
      points: [{ date: "2025-10-11", value: 1250 }],
    });
  });

  it("sem resultados devolve null", () => {
    expect(parseYahooHistory({ chart: { result: null } })).toBeNull();
  });
});
