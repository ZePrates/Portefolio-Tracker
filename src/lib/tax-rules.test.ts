import { describe, expect, it } from "vitest";
import {
  holdingExclusion,
  lastBracketThreshold,
  lossCarryforward,
  mandatoryAggregation,
  reconcileDocument,
  validateTaxFile,
  taxDocPath,
  type AppSourceTotals,
} from "./tax-rules";

describe("holdingExclusion (art. 43.º, n.º 5)", () => {
  it("exatamente 2 anos → 0 %; 2 anos + 1 dia → 10 %", () => {
    expect(holdingExclusion("2022-03-15", "2024-03-15")).toEqual({ years: 2, excludedPct: 0 });
    expect(holdingExclusion("2022-03-15", "2024-03-16")).toEqual({ years: 2, excludedPct: 0.1 });
  });
  it("exatamente 5 anos → 20 %; exatamente 8 anos → 30 %", () => {
    expect(holdingExclusion("2020-06-01", "2025-06-01").excludedPct).toBe(0.2);
    expect(holdingExclusion("2020-06-01", "2025-05-31").excludedPct).toBe(0.1);
    expect(holdingExclusion("2017-06-01", "2025-06-01")).toEqual({ years: 8, excludedPct: 0.3 });
  });
  it("menos de 2 anos conta 100 %", () => {
    expect(holdingExclusion("2025-01-01", "2025-12-31")).toEqual({ years: 0, excludedPct: 0 });
  });
  it("29 de fevereiro: aniversário em ano comum é 28/02", () => {
    expect(holdingExclusion("2020-02-29", "2022-02-28").excludedPct).toBe(0);
    expect(holdingExclusion("2020-02-29", "2022-03-01").excludedPct).toBe(0.1);
    expect(holdingExclusion("2020-02-29", "2025-02-28").excludedPct).toBe(0.2);
  });
});

describe("englobamento obrigatório", () => {
  it("abaixo do limite não se aplica", () => {
    expect(
      mandatoryAggregation({ year: 2025, shortTermGains: 1000, taxableIncome: 80_000 }),
    ).toEqual({
      applies: false,
      shortTermGains: 1000,
      threshold: 83_696,
    });
  });
  it("rendimento + saldo ≥ limite aplica-se", () => {
    expect(
      mandatoryAggregation({ year: 2026, shortTermGains: 1000, taxableIncome: 85_634 })?.applies,
    ).toBe(true);
  });
  it("saldo negativo nunca se aplica; sem rendimento → null", () => {
    expect(
      mandatoryAggregation({ year: 2025, shortTermGains: -5, taxableIncome: 200_000 })?.applies,
    ).toBe(false);
    expect(
      mandatoryAggregation({ year: 2025, shortTermGains: 100, taxableIncome: null }),
    ).toBeNull();
  });
  it("ano sem limite conhecido usa o mais recente", () => {
    expect(lastBracketThreshold(2027)).toEqual({ threshold: 86_634, confirmed: false });
  });
});

describe("reporte de menos-valias", () => {
  it("só nasce em anos com englobamento e só é usada com englobamento", () => {
    const history = [
      { year: 2020, taxableNetGains: -1000, optedAggregation: false },
      { year: 2021, taxableNetGains: -500, optedAggregation: true },
    ];
    const no = lossCarryforward({
      year: 2022,
      history,
      manual: 0,
      currentTaxableGains: 800,
      currentOpted: false,
    });
    expect(no).toMatchObject({ available: 500, applied: 0 });
    const yes = lossCarryforward({
      year: 2022,
      history,
      manual: 0,
      currentTaxableGains: 800,
      currentOpted: true,
    });
    expect(yes).toMatchObject({ available: 500, applied: 500, remaining: 0 });
  });
  it("expira ao fim de 5 anos", () => {
    const history = [{ year: 2019, taxableNetGains: -700, optedAggregation: true }];
    expect(
      lossCarryforward({
        year: 2024,
        history,
        manual: 0,
        currentTaxableGains: 1000,
        currentOpted: true,
      }).applied,
    ).toBe(700);
    expect(
      lossCarryforward({
        year: 2025,
        history,
        manual: 0,
        currentTaxableGains: 1000,
        currentOpted: true,
      }).available,
    ).toBe(0);
  });
  it("mais antigas primeiro; anos com englobamento consomem", () => {
    const history = [
      { year: 2020, taxableNetGains: -300, optedAggregation: true },
      { year: 2021, taxableNetGains: -400, optedAggregation: true },
      { year: 2022, taxableNetGains: 200, optedAggregation: true },
    ];
    const r = lossCarryforward({
      year: 2023,
      history,
      manual: 50,
      currentTaxableGains: 0,
      currentOpted: true,
    });
    expect(r.available).toBe(550);
    expect(r.pools.map((p) => [p.originYear, p.amount])).toEqual([
      [null, 50],
      [2020, 100],
      [2021, 400],
    ]);
  });
});

describe("reconciliação oficial vs. app", () => {
  const app: AppSourceTotals = {
    xtb: {
      realizationValue: 1000,
      acquisitionValue: 800,
      expenses: 5,
      netGains: 195,
      dividendsGross: 100,
      dividendsTaxWithheld: 15,
    },
    scramble: { interestGross: 12.3, interestTaxWithheld: 0 },
  };
  it("confere com diferença ≤ 0,50 € e diverge acima", () => {
    const rows = reconcileDocument(
      { source: "xtb", realization_value: 1000.4, net_gains: 190 },
      app,
    );
    expect(rows).toEqual([
      { label: "Valor de realização", official: 1000.4, app: 1000, diff: 0.4, status: "confere" },
      { label: "Saldo de mais-valias", official: 190, app: 195, diff: -5, status: "diverge" },
    ]);
  });
  it("Scramble compara juros", () => {
    const rows = reconcileDocument({ source: "scramble", interest_gross: 12.3 }, app);
    expect(rows[0]).toMatchObject({ app: 12.3, status: "confere" });
  });
});

describe("ficheiros", () => {
  it("valida tipo e tamanho e gera o caminho com o user_id primeiro", () => {
    expect(validateTaxFile({ name: "a.pdf", size: 100, type: "application/pdf" }).ok).toBe(true);
    expect(validateTaxFile({ name: "a.exe", size: 100, type: "" }).ok).toBe(false);
    expect(
      validateTaxFile({ name: "a.pdf", size: 11 * 1024 * 1024, type: "application/pdf" }).ok,
    ).toBe(false);
    expect(taxDocPath("u1", 2025, "x", "Relatório Fiscal.pdf")).toBe(
      "u1/2025/x-Relatorio-Fiscal.pdf",
    );
  });
});
