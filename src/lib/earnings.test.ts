import { describe, expect, it } from "vitest";
import {
  earningsHourLabel,
  finnhubSymbol,
  parseFinnhubEarnings,
  upcomingEarnings,
  type EarningsAsset,
} from "@/lib/earnings";

const asset = (over: Partial<EarningsAsset> = {}): EarningsAsset => ({
  id: "a1",
  name: "Microsoft Corporation",
  ticker: "MSFT",
  class: "acao_crescimento",
  status: "open",
  ...over,
});

describe("finnhubSymbol", () => {
  it("aceita ações e REITs dos EUA, incluindo o sufixo .US da XTB", () => {
    expect(finnhubSymbol(asset())).toBe("MSFT");
    expect(finnhubSymbol(asset({ ticker: "stag.us", class: "reit" }))).toBe("STAG");
    expect(finnhubSymbol(asset({ ticker: "BRK-B" }))).toBe("BRK-B");
  });

  it("exclui ETFs, metais, P2P, posições fechadas e tickers de outras bolsas", () => {
    expect(finnhubSymbol(asset({ class: "etf", ticker: "VWCE" }))).toBeNull();
    expect(finnhubSymbol(asset({ class: "metal", ticker: "SI=F" }))).toBeNull();
    expect(finnhubSymbol(asset({ status: "closed" }))).toBeNull();
    expect(finnhubSymbol(asset({ ticker: "ASML.NL" }))).toBeNull();
    expect(finnhubSymbol(asset({ ticker: null }))).toBeNull();
  });
});

describe("parseFinnhubEarnings", () => {
  const json = {
    earningsCalendar: [
      {
        date: "2027-01-27",
        epsActual: null,
        epsEstimate: 3.9,
        hour: "amc",
        quarter: 2,
        revenueActual: null,
        revenueEstimate: 80_000_000_000,
        symbol: "MSFT",
        year: 2027,
      },
      { date: "lixo", symbol: "MSFT" },
      { date: "2027-02-01", symbol: "AAPL" },
    ],
  };

  it("lê os campos e descarta linhas inválidas ou de outro símbolo", () => {
    const r = parseFinnhubEarnings(json, asset(), "MSFT");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      symbol: "MSFT",
      name: "Microsoft Corporation",
      date: "2027-01-27",
      hour: "amc",
      quarter: 2,
      year: 2027,
      epsEstimate: 3.9,
    });
  });

  it("resposta sem earningsCalendar (erro, limite) devolve lista vazia", () => {
    expect(parseFinnhubEarnings({ error: "API limit reached" }, asset(), "MSFT")).toEqual([]);
    expect(parseFinnhubEarnings(null, asset(), "MSFT")).toEqual([]);
  });

  it("hora desconhecida fica null", () => {
    const r = parseFinnhubEarnings(
      { earningsCalendar: [{ date: "2027-01-27", hour: "", symbol: "MSFT" }] },
      asset(),
      "MSFT",
    );
    expect(r[0]?.hour).toBeNull();
  });
});

describe("upcomingEarnings", () => {
  const base = parseFinnhubEarnings(
    {
      earningsCalendar: [
        { date: "2026-10-28", symbol: "MSFT" },
        { date: "2026-11-05", symbol: "MSFT" },
        { date: "2026-11-05", symbol: "MSFT" },
        { date: "2027-03-01", symbol: "MSFT" },
      ],
    },
    asset(),
    "MSFT",
  );

  it("só a janela futura, ordenada, sem duplicados", () => {
    const r = upcomingEarnings(base, "2026-10-29", 90);
    expect(r.map((e) => e.date)).toEqual(["2026-11-05"]);
  });

  it("rótulos da hora em PT", () => {
    expect(earningsHourLabel("bmo")).toBe("antes da abertura");
    expect(earningsHourLabel("amc")).toBe("após o fecho");
    expect(earningsHourLabel(null)).toBeNull();
  });
});
