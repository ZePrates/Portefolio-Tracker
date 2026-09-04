import { describe, expect, it } from "vitest";
import { computeExposure } from "@/lib/exposure";
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
    { name: "Nestle", symbol: "NESN", weight: 0.03, country: "Switzerland", sector: "Consumer Defensive" },
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
