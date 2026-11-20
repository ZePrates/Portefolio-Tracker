import { describe, expect, it } from "vitest";
import { countryRisk, mapIndustry, syntheticRating } from "@/lib/valuation/damodaran";
import {
  impliedGrowth,
  monteCarlo,
  runDcf,
  sensitivity,
  type DcfInputs,
} from "@/lib/valuation/dcf";
import { gordon, pvgo, twoStageDdm, ddmScenarios } from "@/lib/valuation/ddm";
import { evaHistory, evaValuation } from "@/lib/valuation/economic-profit";
import { bankValuation } from "@/lib/valuation/financials";
import { fedModel, yardeni } from "@/lib/valuation/macro";
import { cleanPeerValues, multiplesValuation } from "@/lib/valuation/multiples";
import { cagr, median, quantile, seriesCagr } from "@/lib/valuation/stats";
import { computeWacc, releverBeta, unleverBeta } from "@/lib/valuation/wacc";
import { makePeers, makeStatements } from "@/lib/valuation/test-utils";
import { marketAggregate } from "@/lib/valuation/damodaran";

describe("estatística", () => {
  it("quantis com interpolação e CAGR", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10);
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1, 10);
    expect(cagr(-1, 121, 2)).toBeNull();
    expect(seriesCagr([null, 100, 110, 121])).toBeCloseTo(0.1, 10);
  });
});

describe("Damodaran", () => {
  it("liga as indústrias do Yahoo às do Damodaran, das mais específicas às gerais", () => {
    expect(mapIndustry("Technology", "Semiconductors").industry.name).toBe("Semiconductor");
    expect(mapIndustry("Technology", "Semiconductor Equipment & Materials").industry.name).toBe(
      "Semiconductor Equip",
    );
    expect(mapIndustry("Real Estate", "REIT - Industrial").industry.name).toBe("R.E.I.T.");
    expect(mapIndustry("Real Estate", "REIT—Retail").industry.name).toBe("Retail (REITs)");
    expect(mapIndustry("Financial Services", "Banks - Regional").industry.name).toBe(
      "Banks (Regional)",
    );
    expect(mapIndustry("Technology", "Software - Infrastructure").match).toBe("industria");
    expect(mapIndustry("Technology", "Algo Novo").match).toBe("setor");
    expect(mapIndustry(null, null).industry.name).toBe("Total Market");
  });

  it("dá o beta desalavancado pela fórmula de Hamada", () => {
    const semi = mapIndustry("Technology", "Semiconductors").industry;
    const de = semi.debtToCapital! / (1 - semi.debtToCapital!);
    expect(semi.unleveredBeta).toBeCloseTo(semi.beta! / (1 + (1 - semi.taxRate!) * de), 3);
  });

  it("prémio de risco por país, com nomes alternativos e mercado maduro por omissão", () => {
    const pt = countryRisk("Portugal");
    expect(pt.found).toBe(true);
    expect(pt.crp).toBeCloseTo(0.0155, 6);
    expect(pt.erp).toBeCloseTo(0.0578, 6);
    expect(countryRisk("South Korea").country).toBe("Korea");
    const none = countryRisk("Atlântida");
    expect(none.found).toBe(false);
    expect(none.crp).toBe(0);
  });

  it("rating sintético pela cobertura de juros", () => {
    expect(syntheticRating(100, 10)).toMatchObject({ rating: "AAA", spread: 0.004 });
    expect(syntheticRating(26, 10).rating).toBe("BBB");
    expect(syntheticRating(5, 10).rating).toBe("C");
    expect(syntheticRating(100, 0)).toMatchObject({ rating: "AAA", coverage: null });
    // Nas financeiras os limiares são mais baixos.
    expect(syntheticRating(26, 10, true).rating).toBe("AA");
  });
});

describe("WACC", () => {
  it("CAPM, Hamada e média ponderada", () => {
    expect(releverBeta(unleverBeta(1.3, 0.5, 0.25), 0.5, 0.25)).toBeCloseTo(1.3, 10);
    const w = computeWacc({
      riskFree: 0.04,
      beta: 1.2,
      matureErp: 0.05,
      crp: 0,
      preTaxCostOfDebt: 0.06,
      taxRate: 0.25,
      equityValue: 800,
      debtValue: 200,
    });
    expect(w.costOfEquity).toBeCloseTo(0.1, 10);
    expect(w.costOfDebtAfterTax).toBeCloseTo(0.045, 10);
    expect(w.wacc).toBeCloseTo(0.089, 10);
  });
});

const steady: DcfInputs = {
  revenue: 1000,
  margin: 0.2,
  targetMargin: 0.2,
  growth: 0.03,
  terminalGrowth: 0.03,
  wacc: 0.09,
  taxEffective: 0.25,
  taxMarginal: 0.25,
  salesToCapital: 2,
  // ROIC que torna o reinvestimento terminal igual ao dos anos explícitos.
  terminalRoic: 2 * 1.03 * 0.2 * 0.75,
  cash: 100,
  debt: 300,
  minorityInterest: 0,
  shares: 100,
};

describe("DCF", () => {
  it("com crescimento constante coincide com a fórmula de Gordon", () => {
    const r = runDcf(steady)!;
    // FCFF₁ = 1000 × (1,03 × 0,2 × 0,75 − 0,03 / 2) = 139,5 → EV = 139,5 / 6 %
    expect(r.years[0]!.fcff).toBeCloseTo(139.5, 6);
    expect(r.enterpriseValue).toBeCloseTo(2325, 4);
    expect(r.perShare).toBeCloseTo(21.25, 6);
    expect(r.terminalShare).toBeGreaterThan(0.5);
  });

  it("recusa WACC abaixo do crescimento perpétuo", () => {
    expect(runDcf({ ...steady, wacc: 0.03 })).toBeNull();
  });

  it("o DCF invertido recupera o crescimento implícito no preço", () => {
    const price = runDcf({ ...steady, growth: 0.08 })!.perShare;
    expect(impliedGrowth(steady, price)).toBeCloseTo(0.08, 4);
  });

  it("sensibilidade: mais WACC, menos valor; centro = cenário base", () => {
    const g = sensitivity(steady);
    expect(g.values[2]![2]).toBeCloseTo(runDcf(steady)!.perShare, 6);
    expect(g.values[4]![2]!).toBeLessThan(g.values[0]![2]!);
  });

  it("Monte Carlo reprodutível com a mesma semente", () => {
    const a = monteCarlo(steady, 20)!;
    const b = monteCarlo(steady, 20)!;
    expect(a.p50).toBe(b.p50);
    expect(a.p10).toBeLessThan(a.p50);
    expect(a.p90).toBeGreaterThan(a.p50);
    expect(a.probAbovePrice).toBeGreaterThan(0);
    expect(a.bins.reduce((s, x) => s + x.count, 0)).toBeGreaterThan(a.runs * 0.9);
  });
});

describe("múltiplos", () => {
  it("exclui negativos e extremos (P/E acima de 80)", () => {
    expect(cleanPeerValues([15, -3, 120, 20, null], "pe")).toEqual([15, 20]);
  });

  it("mediana dos pares e média dos múltiplos de uma empresa madura", () => {
    const s = makeStatements();
    const r = multiplesValuation(
      {
        price: 30,
        shares: 100,
        eps: 1.603384,
        forwardEps: 1.875,
        ebitda: 266.2,
        ebit: 212.96,
        revenue: 1064.8,
        bookValue: 700,
        cash: 130,
        debt: 200,
        minorityInterest: 0,
      },
      makePeers(),
      marketAggregate(),
      "madura",
    );
    const pe = r.rows.find((x) => x.key === "pe")!;
    expect(pe.reference).toBe(19);
    expect(pe.source).toBe("pares");
    expect(pe.impliedPrice).toBeCloseTo(30.4643, 3);
    const evEbitda = r.rows.find((x) => x.key === "evEbitda")!;
    expect(evEbitda.impliedPrice).toBeCloseTo(31.244, 3);
    expect(r.value).toBeCloseTo((30.4643 + 33.75 + 31.244 + 33.3736) / 4, 3);
    expect(r.rows.find((x) => x.key === "evSales")!.counts).toBe(false);
    expect(s.periods.length).toBe(4);
  });

  it("com menos de 3 pares usa a referência da indústria", () => {
    const r = multiplesValuation(
      {
        price: 30,
        shares: 100,
        eps: 1.6,
        forwardEps: null,
        ebitda: 266,
        ebit: 213,
        revenue: 1065,
        bookValue: 700,
        cash: 130,
        debt: 200,
        minorityInterest: 0,
      },
      makePeers().slice(0, 2),
      marketAggregate(),
      "madura",
    );
    const pe = r.rows.find((x) => x.key === "pe")!;
    expect(pe.source).toBe("industria");
    expect(pe.reference).toBe(marketAggregate().pe);
    expect(r.rows.find((x) => x.key === "forwardPe")!.impliedPrice).toBeNull();
  });
});

describe("dividendos", () => {
  it("Gordon, duas fases com crescimento constante e PVGO", () => {
    expect(gordon(2, 0.08, 0.03)).toBeCloseTo(40, 10);
    const ts = twoStageDdm({
      dividend: 2 / 1.03,
      costOfEquity: 0.08,
      growth: 0.03,
      terminalGrowth: 0.03,
    })!;
    expect(ts.value).toBeCloseTo(40, 6);
    const sc = ddmScenarios({
      dividend: 2,
      costOfEquity: 0.08,
      growth: 0.05,
      terminalGrowth: 0.025,
    });
    expect(sc.map((x) => x.key)).toEqual(["pessimista", "normal", "otimista"]);
    expect(sc[0]!.value!).toBeLessThan(sc[1]!.value!);
    expect(sc[2]!.value!).toBeGreaterThan(sc[1]!.value!);
    expect(pvgo(50, 3, 0.1)).toEqual({ noGrowthValue: 30, pvgo: 20, share: 0.4 });
  });
});

describe("lucro económico", () => {
  it("ROIC e EVA do histórico", () => {
    const h = evaHistory(makeStatements(), 0.08, 0.25);
    // 2023: CI de 2022 = 500 + 200 − 100 = 600; NOPAT = 176 × (1 − 21 %)
    expect(h[1]!.nopat).toBeCloseTo(139.04, 6);
    expect(h[1]!.roic).toBeCloseTo(139.04 / 600, 8);
    expect(h[1]!.eva).toBeCloseTo(139.04 - 48, 6);
  });

  it("sem diferencial ROIC − WACC o valor é o capital investido", () => {
    const v = evaValuation({
      investedCapital: 1000,
      roic: 0.09,
      wacc: 0.09,
      growth: 0.05,
      terminalGrowth: 0.02,
      persistence: 0.3,
      cash: 100,
      debt: 300,
      minorityInterest: 0,
      shares: 10,
    })!;
    expect(v.firmValue).toBeCloseTo(1000, 8);
    expect(v.perShare).toBeCloseTo(80, 8);
  });
});

describe("bancos", () => {
  it("P/VC justificado e retorno em excesso", () => {
    const b = bankValuation({
      bookValue: 1000,
      shares: 100,
      roe: 0.12,
      costOfEquity: 0.1,
      terminalGrowth: 0.03,
      payout: 0.4,
    });
    expect(b.justifiedPb).toBeCloseTo(0.09 / 0.07, 10);
    expect(b.justifiedPbValue).toBeCloseTo((0.09 / 0.07) * 10, 8);
    const flat = bankValuation({
      bookValue: 1000,
      shares: 100,
      roe: 0.1,
      costOfEquity: 0.1,
      terminalGrowth: 0.03,
      payout: 0.4,
    });
    expect(flat.excessReturnValue).toBeCloseTo(10, 8);
  });
});

describe("macro", () => {
  it("FED Model e Yardeni", () => {
    expect(fedModel(20, 0.03)!.verdict).toBe("acoes_atrativas");
    expect(fedModel(25, 0.05)!.verdict).toBe("acoes_caras");
    const y = yardeni(20, 0.06, 0.12)!;
    expect(y.fairPE).toBeCloseTo(1 / 0.048, 8);
    expect(y.gap).toBeCloseTo(20 * 0.048 - 1, 8);
    expect(y.verdict).toBe("neutro");
    expect(yardeni(20, 0.01, 0.12)).toBeNull();
  });
});
