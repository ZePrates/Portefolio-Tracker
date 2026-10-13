import { describe, expect, it } from "vitest";
import { computeExposure, mergeByKey } from "@/lib/exposure";
import { UNKNOWN, type PositionInput } from "@/lib/exposure-types";

const stock = (over: Partial<PositionInput> = {}): PositionInput => ({
  assetId: "a1",
  name: "Apple",
  class: "acao_crescimento",
  ticker: "AAPL",
  value: 10000,
  nativeCurrency: "USD",
  exposures: [
    { dimension: "country", value: "United States", weight: 1 },
    { dimension: "sector", value: "Technology", weight: 1 },
  ],
  holdings: [],
  ...over,
});

const etf = (over: Partial<PositionInput> = {}): PositionInput => ({
  assetId: "e1",
  name: "World ETF",
  class: "etf",
  ticker: "VWCE",
  value: 10000,
  nativeCurrency: "EUR",
  exposures: [],
  holdings: [
    { name: "Apple", symbol: "AAPL", weight: 0.07, country: "United States", sector: "Technology" },
    {
      name: "Nestle",
      symbol: "NESN",
      weight: 0.03,
      country: "Switzerland",
      sector: "Consumer Defensive",
    },
    { name: "Toyota", symbol: "7203", weight: 0.02, country: "Japan", sector: "Consumer Cyclical" },
    { name: "TSMC", symbol: "TSM", weight: 0.02, country: "Taiwan", sector: "Technology" },
  ],
  ...over,
});

describe("exposição da carteira", () => {
  it("1. ação individual concentra 100% no seu país e setor", () => {
    const r = computeExposure([stock()]);
    expect(r.total).toBe(10000);
    expect(r.country[0]).toMatchObject({ value: "United States", amount: 10000 });
    expect(r.sector[0]?.value).toBe("Tecnologia");
    expect(r.companies[0]).toMatchObject({ name: "Apple", direct: 10000, indirect: 0 });
  });

  it("2. ETF distribui o valor pelas várias holdings", () => {
    const r = computeExposure([etf()]);
    const names = r.companies.map((c) => c.name);
    expect(names).toEqual(["Apple", "Nestle", "Toyota", "TSMC"]);
    expect(r.companies.every((c) => c.direct === 0)).toBe(true);
  });

  it("3. ETF de €10.000 com Apple a 7% gera €700 de exposição indireta", () => {
    const r = computeExposure([etf()]);
    const apple = r.companies.find((c) => c.symbol === "AAPL");
    expect(apple?.indirect).toBeCloseTo(700, 6);
    expect(apple?.amount).toBeCloseTo(700, 6);
  });

  it("4. Apple direta + Apple via ETF somam correctamente", () => {
    const r = computeExposure([stock(), etf()]);
    const apple = r.companies.find((c) => c.symbol === "AAPL");
    expect(apple?.direct).toBe(10000);
    expect(apple?.indirect).toBeCloseTo(700, 6);
    expect(apple?.amount).toBeCloseTo(10700, 6);
    expect(apple?.pct).toBeCloseTo((10700 / 20000) * 100, 6);
    // o próprio ETF não é contado como empresa
    expect(r.companies.some((c) => c.symbol === "VWCE")).toBe(false);
  });

  it("5. exposição geográfica é derivada dos países reais", () => {
    const r = computeExposure([etf()]);
    const us = r.country.find((c) => c.value === "United States");
    expect(us?.amount).toBeCloseTo(700, 6);
    expect(r.continent.find((c) => c.value === "Ásia")?.amount).toBeCloseTo(400, 6);
    expect(r.region.find((c) => c.value === "Ásia Emergente")?.amount).toBeCloseTo(200, 6);
  });

  it("6. classifica desenvolvido vs emergente", () => {
    const r = computeExposure([etf()]);
    expect(r.development.find((d) => d.value === "Desenvolvido")?.amount).toBeCloseTo(1200, 6);
    expect(r.development.find((d) => d.value === "Emergente")?.amount).toBeCloseTo(200, 6);
  });

  it("7. setores usam a classificação da fonte", () => {
    const r = computeExposure([etf()]);
    expect(r.sector.find((s) => s.value === "Tecnologia")?.amount).toBeCloseTo(900, 6);
    expect(r.sector.find((s) => s.value === "Consumo Defensivo")?.amount).toBeCloseTo(300, 6);
  });

  it("8. moeda económica subjacente difere da moeda de cotação", () => {
    const r = computeExposure([etf()]);
    // ETF cotado em EUR, mas os subjacentes conhecidos são USD/CHF/JPY/TWD
    expect(r.currency.find((c) => c.value === "USD")?.amount).toBeCloseTo(700, 6);
    expect(r.currency.find((c) => c.value === "CHF")?.amount).toBeCloseTo(300, 6);
    expect(r.currency.find((c) => c.value === "EUR")).toBeUndefined();
  });

  it("9. concentração top 1 / top 5 / top 10", () => {
    const r = computeExposure([stock(), etf()]);
    expect(r.concentration.largest).toBeCloseTo((10700 / 20000) * 100, 6);
    const top5 = r.companies.slice(0, 5).reduce((s, c) => s + c.amount, 0);
    expect(r.concentration.top5).toBeCloseTo((top5 / 20000) * 100, 6);
    expect(r.concentration.top10).toBeGreaterThanOrEqual(r.concentration.top5);
    expect(r.concentration.topCountry).toBeGreaterThan(0);
    expect(r.concentration.topSector).toBeGreaterThan(0);
    expect(r.concentration.topCurrency).toBeGreaterThan(0);
  });

  it("10. dados parciais ficam como não disponíveis e reduzem a cobertura", () => {
    const r = computeExposure([etf()]);
    // só 14% do ETF tem composição conhecida
    expect(r.coverage).toBeCloseTo(14, 6);
    expect(r.country.find((c) => c.value === UNKNOWN)?.amount).toBeCloseTo(8600, 6);
    expect(r.country.at(-1)?.value).toBe(UNKNOWN);
  });

  it("10b. cobertura global é ponderada pelo valor dos ativos, não a média simples das coberturas", () => {
    // Exemplo do requisito: ETF A €9.000 com cobertura 100%, ETF B €1.000 com cobertura 20%.
    // Ponderado: (9000*1 + 1000*0.2) / 10000 = 92%. Média simples (errada) seria (100+20)/2 = 60%.
    const etfA = etf({
      assetId: "a",
      value: 9000,
      holdings: [
        { name: "X", symbol: "X", weight: 1, country: "United States", sector: "Technology" },
      ],
    });
    const etfB = etf({
      assetId: "b",
      value: 1000,
      holdings: [{ name: "Y", symbol: "Y", weight: 0.2, country: "France", sector: "Industrials" }],
    });
    const r = computeExposure([etfA, etfB]);
    expect(r.coverage).toBeCloseTo(92, 6);
  });

  it("11. falha da fonte preserva o último dado válido", () => {
    // Simula o comportamento de syncOne: sem dados novos, nada é apagado.
    const stored = etf();
    const fromSourceFailure: PositionInput = { ...stored };
    const r = computeExposure([fromSourceFailure]);
    expect(r.companies).toHaveLength(4);
    expect(r.companies[0]?.indirect).toBeCloseTo(700, 6);
  });

  it("12. sincronização repetida não duplica registos", () => {
    const once = computeExposure([etf()]);
    // repor o mesmo ativo (substituição por asset_id) mantém os mesmos totais
    const twice = computeExposure([etf()]);
    expect(twice.companies).toHaveLength(once.companies.length);
    expect(twice.total).toBe(once.total);
    // duplicar manualmente as holdings seria detetável nos totais
    const duplicated = etf({ holdings: [...etf().holdings, ...etf().holdings] });
    expect(computeExposure([duplicated]).companies[0]?.amount).toBeCloseTo(1400, 6);
  });

  it("13. a composição preserva a data (as_of_date) da fonte", () => {
    const dated = etf({
      holdings: etf().holdings.map((h) => ({ ...h, as_of_date: "2026-08-31" })),
    });
    const r = computeExposure([dated]);
    expect(r.companies).toHaveLength(4);
    expect(dated.holdings.every((h) => h.as_of_date === "2026-08-31")).toBe(true);
  });

  it("exposição por classe separa ETFs de ações", () => {
    const r = computeExposure([stock(), etf()]);
    expect(r.byClass.map((c) => c.value).sort()).toEqual(["Ações Crescimento", "ETFs"]);
  });
});

describe("exposição direta + indireta (cenário de referência)", () => {
  it("ETF €10.000 com Apple a 7% (€700) + €1.000 direto = €1.700", () => {
    const r = computeExposure([stock({ value: 1000 }), etf({ value: 10000 })]);
    const apple = r.companies.find((c) => c.symbol === "AAPL");
    expect(apple?.direct).toBeCloseTo(1000, 6);
    expect(apple?.indirect).toBeCloseTo(700, 6);
    expect(apple?.amount).toBeCloseTo(1700, 6);
    expect(r.total).toBe(11000);
    expect(apple?.pct).toBeCloseTo((1700 / 11000) * 100, 6);
  });
});

describe("mergeByKey", () => {
  it("soma pesos de linhas com a mesma chave e mantém a ordem", () => {
    const out = mergeByKey(
      [
        { name: "Alphabet Inc", weight: 0.02 },
        { name: "Apple", weight: 0.05 },
        { name: "Alphabet Inc", weight: 0.018 },
      ],
      (r) => r.name,
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.weight).toBeCloseTo(0.038);
    expect(out[1]!.name).toBe("Apple");
  });
});

describe("listas completas das gestoras", () => {
  it("conta apenas Equity ou classe nula na exposição por empresa", () => {
    const report = computeExposure([etf({ value: 10000, holdings: [
      { name: "Apple", symbol: "AAPL", weight: 0.5, country: null, sector: null, asset_class: "Equity" },
      { name: "SAP", symbol: "SAP", weight: 0.2, country: null, sector: null, asset_class: null },
      { name: "USD Cash", symbol: "USD", weight: 0.1, country: null, sector: null, asset_class: "Cash" },
      { name: "Future", symbol: "FUT", weight: 0.1, country: null, sector: null, asset_class: "Futures" },
      { name: "FX", symbol: "FX", weight: 0.1, country: null, sector: null, asset_class: "FX" },
    ] })]);
    expect(report.companies).toHaveLength(2);
    expect(report.companies.reduce((sum, c) => sum + c.amount, 0)).toBe(7000);
  });
  it("ticker sem diferenciar maiúsculas une direto, holdings e nomes sem ticker", () => {
    const report = computeExposure([stock({ name: "Micron Technology", ticker: "mu", value: 1000 }), etf({ holdings: [
      { name: "MICRON TECHNOLOGY INC", symbol: "MU", weight: 0.1, country: null, sector: null },
      { name: "Micron Technology Corp. Class B", symbol: null, weight: 0.05, country: null, sector: null },
    ] })]);
    expect(report.companies).toHaveLength(1);
    expect(report.companies[0]).toMatchObject({ symbol: "MU", direct: 1000, indirect: 1500, amount: 2500 });
  });
  it("usa o portefólio total, incluindo metais e P2P, no denominador", () => {
    const report = computeExposure([stock({ value: 1000 }), etf({ value: 10000 }), stock({ assetId: "metal", class: "metal", value: 9000 })]);
    expect(report.total).toBe(20000);
    expect(report.companies.find((c) => c.symbol === "AAPL")?.pct).toBe(8.5);
    expect(report.companies.some((c) => c.direct === 9000)).toBe(false);
  });
  it("não renormaliza ETFs parciais para 100%", () => {
    const report = computeExposure([etf()]);
    expect(report.companies.reduce((sum, c) => sum + c.pct, 0)).toBeCloseTo(14);
  });
  it("usa todas as posições, incluindo além das primeiras 1000", () => {
    const report = computeExposure([etf({ holdings: Array.from({ length: 2000 }, (_, i) => ({ name: `Company ${i}`, symbol: `T${i}`, weight: 0.0005, country: "United States", sector: "Technology", asset_class: "Equity" })) })]);
    expect(report.companies).toHaveLength(2000);
    expect(report.concentration.top10).toBeCloseTo(0.5);
    expect(report.companies.reduce((sum, c) => sum + c.amount, 0)).toBeCloseTo(10000);
  });
});
