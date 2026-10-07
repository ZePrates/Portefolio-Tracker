import { describe, expect, it } from "vitest";
import { domicileOf, estimatePaymentDate, withholdingAmount, withholdingRateFor } from "./tax";

describe("domicileOf", () => {
  it("usa o prefixo do ISIN quando existe", () => {
    expect(domicileOf({ class: "etf", isin: "IE00BK5BQT80", ticker: "VWCE.DE" })).toBe("IE");
  });

  it("deduz do sufixo do ticker (Yahoo e XTB)", () => {
    expect(domicileOf({ class: "reit", ticker: "O" })).toBe("US");
    expect(domicileOf({ class: "acao_dividendo", ticker: "AAPL.US" })).toBe("US");
    expect(domicileOf({ class: "acao_dividendo", ticker: "ULVR.L" })).toBe("GB");
    expect(domicileOf({ class: "acao_dividendo", ticker: "ALV.DE" })).toBe("DE");
    expect(domicileOf({ class: "acao_dividendo", ticker: "EDP.LS" })).toBe("PT");
  });

  it("devolve null para sufixos desconhecidos", () => {
    expect(domicileOf({ class: "acao_dividendo", ticker: "XYZ.QQ" })).toBeNull();
  });
});

describe("withholdingRateFor", () => {
  it("ações dos EUA: 15% (W-8BEN)", () => {
    expect(withholdingRateFor({ class: "reit", ticker: "O" })).toEqual({
      rate: 0.15,
      source: "default",
      country: "US",
    });
  });

  it("ETF UCITS irlandês não retém", () => {
    expect(withholdingRateFor({ class: "etf", isin: "IE00BK5BQT80" }).rate).toBe(0);
  });

  it("ação irlandesa retém 25% (não é fundo)", () => {
    expect(withholdingRateFor({ class: "acao_dividendo", isin: "IE00B4BNMY34" }).rate).toBe(0.25);
  });

  it("a taxa definida no ativo prevalece (incluindo 0)", () => {
    expect(withholdingRateFor({ class: "reit", ticker: "O", withholding_rate: 0.3 })).toMatchObject(
      {
        rate: 0.3,
        source: "asset",
      },
    );
    expect(withholdingRateFor({ class: "reit", ticker: "O", withholding_rate: 0 }).rate).toBe(0);
  });

  it("país desconhecido → 0 sinalizado como unknown", () => {
    expect(withholdingRateFor({ class: "acao_dividendo", ticker: "XYZ.QQ" })).toEqual({
      rate: 0,
      source: "unknown",
      country: null,
    });
  });
});

describe("withholdingAmount / estimatePaymentDate", () => {
  it("arredonda ao cêntimo e ignora valores não positivos", () => {
    expect(withholdingAmount(10.37, 0.15)).toBe(1.56);
    expect(withholdingAmount(0, 0.15)).toBe(0);
    expect(withholdingAmount(10, 0)).toBe(0);
  });

  it("estima o pagamento 14 dias após a ex-date (atravessa o ano)", () => {
    expect(estimatePaymentDate("2025-12-24")).toBe("2026-01-07");
    expect(estimatePaymentDate("2025-03-01", 30)).toBe("2025-03-31");
  });
});
