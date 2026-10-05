import { describe, expect, it } from "vitest";
import { portfolioIntelligence, computeLookThrough } from "@/lib/intelligence";
import type { AssetClass } from "@/lib/portfolio-types";
import type { PositionInput } from "@/lib/exposure-types";

const a = (id: string, v: number, c: AssetClass, name = id) => ({
  id,
  user_id: "u",
  class: c,
  name,
  ticker: null,
  isin: null,
  quantity: 1,
  average_price: v,
  current_price: v,
  invested_amount: v,
  current_value: v,
  currency: "EUR",
  metal_type: null,
  p2p_group: null,
  annual_yield: null,
  notes: null,
  native_currency: "EUR",
  purchase_price_native: v,
  current_price_native: v,
  dividend_frequency: null,
  last_dividend_import: null,
  status: "open",
  realized_pl: 0,
  total_fees: 0,
  closed_at: null,
  created_at: "",
  updated_at: "",
});

const pos = (over: Partial<PositionInput> & { assetId: string; value: number }): PositionInput => ({
  name: over.assetId,
  class: "etf",
  ticker: null,
  nativeCurrency: "EUR",
  exposures: [],
  holdings: [],
  ...over,
});

describe("portfolio intelligence — sem dados de holdings (recai em posição direta)", () => {
  it("gera score e riscos quando uma posição domina a carteira", () => {
    const r = portfolioIntelligence([a("A", 900, "etf"), a("B", 100, "reit")]);
    expect(r.score).toBeLessThan(100);
    expect(r.risks.length).toBeGreaterThan(0);
  });
});

describe("portfolio intelligence — look-through (o ponto central da correção)", () => {
  it("NÃO marca risco de concentração por causa da classe 'etf' — um ETF é diversificado por dentro", () => {
    // 100% da carteira num único ETF, mas com 30 holdings pequenas e parecidas lá dentro:
    // a classe domina (100%), mas nenhuma EMPRESA individual domina.
    const holdings = Array.from({ length: 30 }, (_, i) => ({
      name: `Empresa ${i}`,
      symbol: `E${i}`,
      weight: 1 / 30,
      country: "United States",
      sector: "Technology",
    }));
    const assets = [a("VWCE", 1000, "etf", "ETF Diversificado")];
    const positions: PositionInput[] = [
      pos({ assetId: "VWCE", class: "etf", value: 1000, holdings }),
    ];
    const r = portfolioIntelligence(assets, undefined, positions);
    // Nenhuma empresa individual passa de 1000/30/1000 = 3.3%.
    expect(r.metrics.largestCompany).toBeCloseTo(3.33, 1);
    // Não há nenhuma mensagem sobre "uma classe representa X% da carteira" — esse tipo de risco já não existe.
    expect(r.risks.some((x) => /classe/i.test(x))).toBe(false);
    expect(r.instrumentMix.find((m) => m.class === "etf")?.weight).toBeCloseTo(1, 6);
  });

  it("soma a posição direta com o peso da mesma empresa dentro do ETF (a concentração real)", () => {
    const assets = [
      a("MSFT_DIRECT", 200, "acao_crescimento", "Microsoft"),
      a("VWCE", 800, "etf", "ETF Global"),
    ];
    const positions: PositionInput[] = [
      pos({
        assetId: "MSFT_DIRECT",
        name: "Microsoft",
        class: "acao_crescimento",
        value: 200,
        holdings: [],
      }),
      pos({
        assetId: "VWCE",
        class: "etf",
        value: 800,
        holdings: [
          { name: "Microsoft Corp", symbol: "MSFT", weight: 0.05, country: "US", sector: "Tech" },
          { name: "Apple Inc", symbol: "AAPL", weight: 0.04, country: "US", sector: "Tech" },
        ],
      }),
    ];
    const r = portfolioIntelligence(assets, undefined, positions);
    // Direto: 200/1000 = 20%. Dentro do ETF: 800*0.05/1000 = 4%. Total real: 24%.
    expect(r.metrics.largestCompany).toBeCloseTo(24, 1);
    expect(r.topCompanies[0]?.label).toBe("Microsoft");
    expect(r.risks.some((x) => /Microsoft|única empresa/.test(x))).toBe(true);
  });

  it("holdings de ETF com cobertura baixa entram como 'unknown', nunca atribuídas a uma empresa ao acaso", () => {
    const assets = [a("VWCE", 1000, "etf", "ETF Parcial")];
    const positions: PositionInput[] = [
      pos({
        assetId: "VWCE",
        class: "etf",
        value: 1000,
        // só 20% do fundo tem composição conhecida
        holdings: [{ name: "Empresa X", symbol: "X", weight: 0.2, country: "US", sector: "Tech" }],
      }),
    ];
    const r = portfolioIntelligence(assets, undefined, positions);
    expect(r.metrics.unknownLookThrough).toBeCloseTo(80, 1);
    expect(r.risks.some((x) => /ETFs sem composição/.test(x))).toBe(true);
  });
});

describe("computeLookThrough", () => {
  it("devolve lista vazia e unknownWeight 0 quando o total é zero", () => {
    const r = computeLookThrough([], 0);
    expect(r.companies).toEqual([]);
    expect(r.unknownWeight).toBe(0);
  });
});

describe("exposure coverage (dimensão geografia/setor, não muda com esta correção)", () =>
  it("sinaliza cobertura incompleta e reduz a confiança do score", () => {
    const r = portfolioIntelligence([a("A", 900, "etf"), a("B", 100, "reit")], {
      total: 1000,
      byClass: [],
      country: [],
      region: [],
      continent: [],
      development: [],
      sector: [],
      industry: [],
      currency: [],
      companies: [],
      concentration: {
        largest: 90,
        top5: 100,
        top10: 100,
        topCountry: 0,
        topSector: 0,
        topCurrency: 0,
      },
      coverage: 70,
    });
    expect(r.metrics.coverage).toBe(70);
    expect(r.risks.some((x) => x.includes("cobertura de 70.0%"))).toBe(true);
    expect(r.recommendations.some((x) => x.includes("dados de exposição"))).toBe(true);
  }));
