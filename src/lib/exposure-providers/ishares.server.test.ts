import { afterEach, describe, expect, it, vi } from "vitest";
import { isharesProvider } from "@/lib/exposure-providers/ishares.server";

const PRODUCT_LIST_HTML = `
<html><body>
<table>
<tr><td><a href="/ch/individual/en/products/251882/ishares-msci-world-ucits-etf-acc-fund">SWDA</a></td><td><a href="/ch/individual/en/products/251882/ishares-msci-world-ucits-etf-acc-fund">iShares Core MSCI World UCITS ETF</a></td></tr>
<tr><td><a href="/ch/individual/en/products/251767/ishares-msci-europe-sri-ucits-etf">IESE</a></td><td><a href="/ch/individual/en/products/251767/ishares-msci-europe-sri-ucits-etf">iShares MSCI Europe SRI UCITS ETF</a></td></tr>
</table>
</body></html>`;

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
    if (!r) return { ok: false, status: 404, text: async () => "" };
    return { ok: r.ok, status: r.ok ? 200 : 500, text: async () => r.body };
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

  it("resolve pelo ticker na lista de produtos e obtém as holdings reais (sem CASH, pesos corretos)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "etf-product-list": { ok: true, body: PRODUCT_LIST_HTML },
        "1467271812596.ajax": { ok: true, body: HOLDINGS_CSV },
      }),
    );
    const result = await isharesProvider.fetch({
      isin: "IE00B4L5Y983",
      ticker: "SWDA.DE",
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

  it("casa o ticker ignorando o sufixo de bolsa (.DE/.NL/.UK)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "etf-product-list": { ok: true, body: PRODUCT_LIST_HTML },
        "1467271812596.ajax": { ok: true, body: HOLDINGS_CSV },
      }),
    );
    const result = await isharesProvider.fetch({
      isin: "IE00B52VJ196",
      ticker: "IESE.NL",
      name: "iShares MSCI Europe SRI UCITS ETF",
      fundFamily: "iShares",
    });
    expect(result?.providerRef).toMatchObject({ productId: "251767" });
  });

  it("reutiliza cachedRef sem repetir a resolução por ticker", async () => {
    const fetchMock = mockFetch({ "1467271812596.ajax": { ok: true, body: HOLDINGS_CSV } });
    vi.stubGlobal("fetch", fetchMock);
    const result = await isharesProvider.fetch({
      isin: "IE00B4L5Y983",
      ticker: "SWDA.DE",
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
      cachedRef: {
        productId: "251882",
        slug: "ishares-msci-world-ucits-etf-acc-fund",
        locale: "ch/individual/en",
      },
    });
    expect(result?.holdings.length).toBeGreaterThan(0);
    // só a chamada às holdings — nenhuma à lista de produtos
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("devolve null quando o ticker não é encontrado na lista", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "etf-product-list": { ok: true, body: PRODUCT_LIST_HTML } }),
    );
    const result = await isharesProvider.fetch({
      isin: "XX0000000000",
      ticker: "TICKER-INEXISTENTE",
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
      ticker: "SWDA.DE",
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
    });
    expect(result).toBeNull();
  });

  it("devolve null sem ticker e sem cache (não adivinha)", async () => {
    const result = await isharesProvider.fetch({
      isin: "IE00B4L5Y983",
      ticker: null,
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
    });
    expect(result).toBeNull();
  });
});
