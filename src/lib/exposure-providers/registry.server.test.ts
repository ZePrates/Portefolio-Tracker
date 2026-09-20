import { describe, expect, it, vi } from "vitest";
import {
  findManagerProvider,
  fetchOfficialComposition,
} from "@/lib/exposure-providers/registry.server";

describe("registry: findManagerProvider", () => {
  it("encontra a iShares pelo fundFamily", () => {
    const p = findManagerProvider({ isin: null, ticker: null, name: "", fundFamily: "iShares" });
    expect(p?.slug).toBe("ishares");
  });

  it("encontra a Vanguard pelo fundFamily", () => {
    const p = findManagerProvider({ isin: null, ticker: null, name: "", fundFamily: "Vanguard" });
    expect(p?.slug).toBe("vanguard");
  });

  it("devolve null para gestora sem fornecedor implementado (ex.: VanEck)", () => {
    const p = findManagerProvider({ isin: null, ticker: null, name: "", fundFamily: "VanEck" });
    expect(p).toBeNull();
  });

  it("devolve null para gestora completamente desconhecida", () => {
    const p = findManagerProvider({ isin: null, ticker: null, name: "", fundFamily: "Invesco" });
    expect(p).toBeNull();
  });
});

describe("registry: fetchOfficialComposition", () => {
  it("sem gestora reconhecida, tenta o justETF (fornecedor especializado) antes de desistir", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchOfficialComposition({
      isin: "XX0000000000",
      ticker: "X",
      name: "Fundo genérico",
      fundFamily: "Gestora Desconhecida",
    });
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // só o justETF, nenhum ManagerProvider correspondeu
    vi.unstubAllGlobals();
  });

  it("devolve null quando NEM a gestora reconhecida NEM o justETF respondem (ex.: sem rede)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await fetchOfficialComposition({
      isin: "IE00B4L5Y983",
      ticker: "SWDA",
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
    });
    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });

  it("não chama o justETF quando a fonte oficial da gestora já responde", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("etf-product-list")) {
        return {
          ok: true,
          status: 200,
          text: async () => '<a href="/ch/individual/en/products/251882/x">SWDA</a>',
        };
      }
      if (url.includes("1467271812596.ajax")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              'Fund Holdings as of,"Sep 12, 2026"',
              "",
              "Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Currency,FX Rate,Market Currency,Accrual Date",
              '"AAPL","APPLE INC","Technology","Equity","1","5.00","1","1","1","US","NASDAQ","USD","1","USD","-"',
            ].join("\n"),
        };
      }
      throw new Error(`chamada inesperada a justETF: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchOfficialComposition({
      isin: "IE00B4L5Y983",
      ticker: "SWDA",
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
    });
    expect(result?.source).toBe("ishares");
    vi.unstubAllGlobals();
  });
});
