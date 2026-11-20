import { describe, expect, it } from "vitest";
import {
  buildMarket,
  buildStatements,
  normalizeCurrency,
  parseEcbCsv,
  parseSearchNews,
  parseSearchQuotes,
  parseTimeseries,
  summaryBasics,
} from "@/lib/valuation/yahoo-parse";

const entry = (asOfDate: string, v: number, currencyCode = "TWD") => ({
  asOfDate,
  currencyCode,
  periodType: "12M",
  reportedValue: { raw: v },
});

describe("fundamentals-timeseries", () => {
  const json = {
    timeseries: {
      result: [
        {
          meta: { type: ["annualTotalRevenue"] },
          annualTotalRevenue: [
            entry("2023-12-31", 100),
            entry("2024-12-31", 120),
            entry("2025-12-31", 150),
          ],
        },
        {
          meta: { type: ["annualEBIT"] },
          annualEBIT: [entry("2024-12-31", 30), entry("2025-12-31", 40)],
        },
        {
          meta: { type: ["annualOperatingIncome"] },
          annualOperatingIncome: [entry("2025-12-31", 42)],
        },
        {
          meta: { type: ["annualOrdinarySharesNumber"] },
          annualOrdinarySharesNumber: [entry("2025-12-31", 10)],
        },
        {
          meta: { type: ["trailingTotalRevenue"] },
          trailingTotalRevenue: [entry("2025-06-30", 140), entry("2026-06-30", 160)],
        },
        { meta: { type: ["annualTotalDebt"] }, annualTotalDebt: [null] },
      ],
    },
  };

  it("alinha os anos pela receita e escolhe a linha preferida", () => {
    const ts = parseTimeseries(json);
    expect(ts.periods).toEqual(["2023-12-31", "2024-12-31", "2025-12-31"]);
    expect(ts.currency).toBe("TWD");
    expect(ts.trailing["TotalRevenue"]).toBe(160);
    const s = buildStatements(ts, 0.03);
    expect(s.revenue[0]).toBeCloseTo(3, 10);
    expect(s.revenue[2]).toBeCloseTo(4.5, 10);
    // Resultado operacional preferido ao EBIT quando existe.
    expect(s.operatingIncome[0]).toBeNull();
    expect(s.operatingIncome[1]).toBeCloseTo(0.9, 10);
    expect(s.operatingIncome[2]).toBeCloseTo(1.26, 10);
    // Ações não se convertem de moeda.
    expect(s.sharesOutstanding).toEqual([null, null, 10]);
    expect(s.totalDebt).toEqual([null, null, null]);
  });
});

describe("quoteSummary", () => {
  it("cotações em cêntimos: preço em libras e capitalização coerente com as ações", () => {
    expect(normalizeCurrency("GBp")).toEqual({ currency: "GBP", factor: 0.01 });
    const q = {
      price: {
        regularMarketPrice: { raw: 4896 },
        currency: "GBp",
        marketCap: { raw: 105_428_852_736 },
      },
      summaryDetail: { dividendYield: { raw: 0.0315 }, fiftyTwoWeekHigh: { raw: 5000 } },
      defaultKeyStatistics: { sharesOutstanding: { raw: 2_153_366_959 } },
      financialData: { financialCurrency: "EUR" },
    };
    const b = summaryBasics(q)!;
    expect(b).toMatchObject({ priceCurrency: "GBP", factor: 0.01, financialCurrency: "EUR" });
    expect(b.price).toBeCloseTo(48.96, 10);
    const m = buildMarket(q, b);
    expect(m.shares).toBeCloseTo(2_153_366_959, -3);
    expect(m.dividendRate).toBeCloseTo(0.0315 * 48.96, 10);
    expect(m.fiftyTwoWeekHigh).toBeCloseTo(50, 10);
  });

  it("corrige uma capitalização em cêntimos", () => {
    const q = {
      price: {
        regularMarketPrice: { raw: 1000 },
        currency: "GBp",
        marketCap: { raw: 1_000_000_000 },
      },
      defaultKeyStatistics: { sharesOutstanding: { raw: 1_000_000 } },
    };
    const m = buildMarket(q, summaryBasics(q)!);
    expect(m.marketCap).toBeCloseTo(10_000_000, 3);
    expect(m.shares).toBeCloseTo(1_000_000, 3);
  });
});

describe("pesquisa e BCE", () => {
  it("só ações na pesquisa e notícias com ligação", () => {
    const hits = parseSearchQuotes({
      quotes: [
        { symbol: "ASML", quoteType: "EQUITY", longname: "ASML Holding N.V.", exchDisp: "NASDAQ" },
        { symbol: "ASMG", quoteType: "ETF", shortname: "Leverage Shares" },
      ],
    });
    expect(hits.map((h) => h.symbol)).toEqual(["ASML"]);
    const news = parseSearchNews({
      news: [
        {
          title: "Resultados",
          publisher: "Reuters",
          link: "https://x.test/a",
          providerPublishTime: 1795006353,
        },
        { title: "Sem ligação" },
      ],
    });
    expect(news).toHaveLength(1);
    expect(news[0]!.publishedAt).toMatch(/^2026-11-/);
  });

  it("último valor do CSV do BCE", () => {
    const csv = [
      "KEY,FREQ,TIME_PERIOD,OBS_VALUE,OBS_STATUS",
      "YC,B,2026-11-17,3.4245648137,A",
      "YC,B,2026-11-16,3.4224059614,A",
    ].join("\n");
    expect(parseEcbCsv(csv)).toBeCloseTo(3.4245648137, 10);
  });
});
