import { afterEach, describe, expect, it, vi } from "vitest";
import { isharesProvider } from "@/lib/exposure-providers/ishares.server";

const SCREENER_JSON = {
  data: {
    tableData: {
      data: [
        {
          isin: "IE00B4L5Y983",
          productPageUrl: "/uk/individual/en/products/251882/ishares-msci-world-ucits-etf-acc-fund",
        },
        {
          isin: "IE00BJ0KDQ92",
          productPageUrl:
            "/uk/individual/en/products/280510/ishares-sp-500-information-technology-sector-ucits-etf",
        },
      ],
    },
  },
};

const HOLDINGS_CSV = [
  " iShares Core MSCI World UCITS ETF",
  'Fund Holdings as of,"Sep 12, 2026"',
  'Inception Date,"Jan 1, 2010"',
  "",
  "Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Currency,FX Rate,Market Currency,Accrual Date",
  '"AAPL","APPLE INC","Information Technology","Equity","100000","5.20","100000","1000","100","United States","NASDAQ","USD","1.00","USD","-"',
  '"MSFT","MICROSOFT CORP","Information Technology","Equity","90000","4.80","90000","900","100","United States","NASDAQ","USD","1.00","USD","-"',
  '"-","USD CASH","-","Cash","5000","0.30","5000","-","-","United States","-","USD","1.00","USD","-"',
].join("\n");

function mockFetch(responses: Record<string, { ok: boolean; body: string }>) {
  return vi.fn(async (url: string) => {
    const match = Object.keys(responses).find((k) => url.includes(k));
    const r = match ? responses[match] : undefined;
    if (!r) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
    return {
      ok: r.ok,
      status: r.ok ? 200 : 500,
      text: async () => r.body,
      json: async () => JSON.parse(r.body),
    };
  });
}

describe("isharesProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches por fundFamily iShares ou BlackRock", () => {
    expect(
      isharesProvider.matches({ isin: null, ticker: null, name: "", fundFamily: "iShares" }),
    ).toBe(true);
    expect(
      isharesProvider.matches({ isin: null, ticker: null, name: "", fundFamily: "BlackRock" }),
    ).toBe(true);
    expect(
      isharesProvider.matches({ isin: null, ticker: null, name: "", fundFamily: "Vanguard" }),
    ).toBe(false);
  });

  it("resolve o ISIN e obtém as holdings reais (sem CASH, pesos corretos)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "product-screener-v3.jsn": { ok: true, body: JSON.stringify(SCREENER_JSON) },
        "1467271812596.ajax": { ok: true, body: HOLDINGS_CSV },
      }),
    );
    const result = await isharesProvider.fetch({
      isin: "IE00B4L5Y983",
      ticker: "SWDA",
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
    });
    expect(result).not.toBeNull();
    expect(result?.source).toBe("ishares");
    expect(result?.asOfDate).toBe("2026-09-12");
    expect(result?.holdings).toHaveLength(2); // CASH excluído
    expect(result?.holdings[0]).toMatchObject({ name: "APPLE INC", symbol: "AAPL" });
    expect(result?.holdings[0]?.weight).toBeCloseTo(0.052, 6);
    expect(result?.providerRef).toMatchObject({ productId: "251882" });
  });

  it("reutiliza cachedRef sem repetir a resolução por ISIN", async () => {
    const fetchMock = mockFetch({ "1467271812596.ajax": { ok: true, body: HOLDINGS_CSV } });
    vi.stubGlobal("fetch", fetchMock);
    const result = await isharesProvider.fetch({
      isin: "IE00B4L5Y983",
      ticker: "SWDA",
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
      cachedRef: {
        productId: "251882",
        slug: "ishares-msci-world-ucits-etf-acc-fund",
        locale: "ch/individual/en",
      },
    });
    expect(result?.holdings.length).toBeGreaterThan(0);
    // só a chamada às holdings — nenhuma ao screener de resolução
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("devolve null quando o ISIN não é encontrado no screener", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "product-screener-v3.jsn": { ok: true, body: JSON.stringify(SCREENER_JSON) } }),
    );
    const result = await isharesProvider.fetch({
      isin: "XX0000000000",
      ticker: "X",
      name: "ETF desconhecido",
      fundFamily: "iShares",
    });
    expect(result).toBeNull();
  });

  it("devolve null quando a fonte falha (rede), nunca lança", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await isharesProvider.fetch({
      isin: "IE00B4L5Y983",
      ticker: "SWDA",
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
    });
    expect(result).toBeNull();
  });

  it("tenta por ticker exato quando não há ISIN, mas nunca por nome", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "product-screener-v3.jsn": { ok: true, body: JSON.stringify(SCREENER_JSON) } }),
    );
    const result = await isharesProvider.fetch({
      isin: null,
      ticker: "TICKER-INEXISTENTE",
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
    });
    expect(result).toBeNull();
  });

  it("devolve null sem ISIN, sem ticker e sem cache", async () => {
    const result = await isharesProvider.fetch({
      isin: null,
      ticker: null,
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
    });
    expect(result).toBeNull();
  });
});
