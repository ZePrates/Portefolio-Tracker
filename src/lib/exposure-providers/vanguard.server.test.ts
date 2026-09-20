import { afterEach, describe, expect, it, vi } from "vitest";
import { vanguardProvider } from "@/lib/exposure-providers/vanguard.server";

const PRODUCT_HTML = `
<html><body>
<h2>Holdings details</h2>
<p>As at 31 Jul 2026</p>
<table>
<tr><th>Holding name</th><th>% of market value</th><th>Sector</th><th>Region</th></tr>
<tr><td>Apple Inc</td><td>4.26%</td><td>Technology</td><td>US</td></tr>
<tr><td>Microsoft Corp</td><td>3.80%</td><td>Technology</td><td>US</td></tr>
<tr><td>Cash</td><td>0.20%</td><td>-</td><td>-</td></tr>
</table>
Fund and benchmark
</body></html>`;

function mockFetch(byUrlFragment: Record<string, { ok: boolean; body: string }>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(byUrlFragment).find((k) => url.includes(k));
    const r = key ? byUrlFragment[key] : undefined;
    if (!r) return { ok: false, status: 404, text: async () => "" };
    return { ok: r.ok, status: r.ok ? 200 : 500, text: async () => r.body };
  });
}

describe("vanguardProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches por fundFamily Vanguard", () => {
    expect(
      vanguardProvider.matches({ isin: null, ticker: null, name: "", fundFamily: "Vanguard" }),
    ).toBe(true);
    expect(
      vanguardProvider.matches({ isin: null, ticker: null, name: "", fundFamily: "iShares" }),
    ).toBe(false);
  });

  it("sem cachedRef devolve null (não há resolução automática de ISIN para a Vanguard)", async () => {
    const result = await vanguardProvider.fetch({
      isin: "IE00BK5BQT80",
      ticker: "VWCE",
      name: "Vanguard FTSE All-World UCITS ETF",
      fundFamily: "Vanguard",
    });
    expect(result).toBeNull();
  });

  it("com cachedRef obtém as holdings reais (sem CASH, pesos corretos)", async () => {
    const fetchMock = mockFetch({
      "/professional/product/etf/equity/9679": { ok: true, body: PRODUCT_HTML },
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await vanguardProvider.fetch({
      isin: "IE00BK5BQT80",
      ticker: "VWCE",
      name: "Vanguard FTSE All-World UCITS ETF",
      fundFamily: "Vanguard",
      cachedRef: {
        domain: "www.vanguard.co.uk",
        path: "/professional/product/etf/equity/9679/ftse-all-world-ucits-etf-usd-accumulating",
      },
    });
    expect(result).not.toBeNull();
    expect(result?.source).toBe("vanguard");
    expect(result?.asOfDate).toBe("2026-07-31");
    expect(result?.holdings).toHaveLength(2); // Cash excluído
    expect(result?.holdings[0]).toMatchObject({ name: "Apple Inc", sector: "Technology" });
    expect(result?.holdings[0]?.weight).toBeCloseTo(0.0426, 6);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("devolve null quando a fonte falha (rede), nunca lança", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await vanguardProvider.fetch({
      isin: "IE00BK5BQT80",
      ticker: "VWCE",
      name: "Vanguard FTSE All-World UCITS ETF",
      fundFamily: "Vanguard",
      cachedRef: { domain: "www.vanguard.co.uk", path: "/professional/product/etf/equity/9679/x" },
    });
    expect(result).toBeNull();
  });
});
