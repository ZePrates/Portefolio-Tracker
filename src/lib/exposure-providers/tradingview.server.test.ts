import { describe, expect, it } from "vitest";
import { parseTradingViewScan } from "@/lib/exposure-providers/tradingview.server";

const PAYLOAD = {
  totalCount: 2,
  data: [
    { s: "EURONEXT:SWDA", d: ["SWDA", "EUR", "Ireland", "IE00B4L5Y983"] },
    { s: "BMV:IWDA/N", d: ["IWDA/N", "MXN", "Ireland", "IE00B4L5Y983"] },
  ],
};

describe("parseTradingViewScan", () => {
  it("prefere a listagem em EUR e extrai identidade", () => {
    const r = parseTradingViewScan(PAYLOAD, "IE00B4L5Y983");
    expect(r).toMatchObject({
      symbol: "SWDA",
      exchange: "EURONEXT",
      currency: "EUR",
      domicile: "Ireland",
      isin: "IE00B4L5Y983",
    });
  });

  it("devolve null quando o ISIN não aparece", () => {
    expect(parseTradingViewScan(PAYLOAD, "XX0000000000")).toBeNull();
  });

  it("devolve null para respostas inválidas", () => {
    expect(parseTradingViewScan(null, "IE00B4L5Y983")).toBeNull();
    expect(parseTradingViewScan({}, "IE00B4L5Y983")).toBeNull();
    expect(parseTradingViewScan({ data: "x" }, "IE00B4L5Y983")).toBeNull();
  });

  it("tolera linhas malformadas", () => {
    const r = parseTradingViewScan(
      { data: [null, { s: 1 }, { s: "X:Y", d: "no" }, ...PAYLOAD.data] },
      "IE00B4L5Y983",
    );
    expect(r?.isin).toBe("IE00B4L5Y983");
  });
});
