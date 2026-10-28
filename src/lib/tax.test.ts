import { describe, expect, it } from "vitest";
import {
  domicileOf,
  estimatePaymentDate,
  medianPaymentLag,
  paymentLagByAsset,
  withholdingAmount,
  withholdingRateFor,
} from "./tax";

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

describe("medianPaymentLag / paymentLagByAsset", () => {
  const confirmed = (ex: string, pay: string, assetId = "a") => ({
    asset_id: assetId,
    ex_date: ex,
    payment_date: pay,
    payment_date_estimated: false,
  });

  it("devolve a mediana do desfasamento dos pagamentos confirmados", () => {
    expect(
      medianPaymentLag([
        confirmed("2026-01-02", "2026-01-30"), // 28
        confirmed("2026-04-02", "2026-04-29"), // 27
        confirmed("2026-07-02", "2026-07-30"), // 28
      ]),
    ).toBe(28);
  });

  it("com número par de amostras arredonda a média das duas do meio", () => {
    expect(
      medianPaymentLag([
        confirmed("2026-01-01", "2026-01-15"), // 14
        confirmed("2026-04-01", "2026-04-16"), // 15
      ]),
    ).toBe(15);
  });

  it("sem amostras suficientes devolve null (cai nos 14 dias por omissão)", () => {
    expect(medianPaymentLag([])).toBeNull();
    expect(medianPaymentLag([confirmed("2026-01-01", "2026-01-30")])).toBeNull();
  });

  it("ignora registos estimados, sem ex-date e desfasamentos implausíveis", () => {
    expect(
      medianPaymentLag([
        { ex_date: "2026-01-01", payment_date: "2026-01-15", payment_date_estimated: true },
        { ex_date: "2026-04-01", payment_date: "2026-04-15" },
        { ex_date: null, payment_date: "2026-05-01", payment_date_estimated: false },
        confirmed("2026-06-01", "2026-06-01"), // 0: lançamento manual com ex-date = pagamento
        confirmed("2026-07-01", "2026-12-01"), // 153: dado mau
        confirmed("2026-08-01", "2026-07-20"), // negativo
      ]),
    ).toBeNull();
  });

  it("usa só os 8 pagamentos mais recentes", () => {
    const old = Array.from({ length: 5 }, (_, i) =>
      confirmed(`2023-0${i + 1}-01`, `2023-0${i + 1}-31`),
    ); // 30 dias
    const recent = Array.from({ length: 8 }, (_, i) => {
      const m = String(i + 1).padStart(2, "0");
      return confirmed(`2025-${m}-01`, `2025-${m}-11`); // 10 dias
    });
    expect(medianPaymentLag([...old, ...recent])).toBe(10);
  });

  it("agrupa por ativo e só inclui os que têm amostras suficientes", () => {
    const lags = paymentLagByAsset([
      confirmed("2026-01-02", "2026-01-30", "kmb"),
      confirmed("2026-04-02", "2026-04-30", "kmb"),
      confirmed("2026-01-02", "2026-01-16", "o"),
      { ex_date: "2026-01-02", payment_date: "2026-01-16", payment_date_estimated: false },
    ]);
    expect(lags.get("kmb")).toBe(28);
    expect(lags.has("o")).toBe(false);
    expect(lags.size).toBe(1);
  });

  it("estimatePaymentDate aceita o desfasamento medido e, sem ele, usa 14 dias", () => {
    expect(estimatePaymentDate("2026-10-01", 28)).toBe("2026-10-29");
    expect(estimatePaymentDate("2026-10-01", undefined)).toBe("2026-10-15");
  });
});
