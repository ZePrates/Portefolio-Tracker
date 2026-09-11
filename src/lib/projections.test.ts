import { describe, expect, it } from "vitest";
import { finalProjection, goalProjection, projectPortfolio } from "./projections";

describe("projections", () => {
  it("mantém o capital quando retorno e aporte são zero", () => {
    const result = finalProjection({
      currentValue: 1000,
      monthlyContribution: 0,
      annualReturnPct: 0,
      years: 5,
    });
    expect(result.value).toBe(1000);
    expect(result.invested).toBe(1000);
  });

  it("cresce com aportes mesmo sem retorno", () => {
    const result = finalProjection({
      currentValue: 1000,
      monthlyContribution: 100,
      annualReturnPct: 0,
      years: 1,
    });
    expect(result.value).toBe(2200);
    expect(result.invested).toBe(2200);
  });

  it("aplica capitalização mensal (taxa anual efetiva, não nominal/12)", () => {
    // 12% ao ano, capitalizado mensalmente, deve reproduzir exatamente 12% ao fim de 12 meses.
    // Não é 1000 * (1.01)^12 = 1126,825 — isso corresponderia a uma taxa NOMINAL de 12%/ano
    // (1%/mês simples), que dá um retorno efetivo de ~12,68%, superior ao indicado.
    const result = finalProjection({
      currentValue: 1000,
      monthlyContribution: 0,
      annualReturnPct: 12,
      years: 1,
    });
    expect(result.value).toBeCloseTo(1120, 2);
  });

  it("suporta retorno negativo moderado", () => {
    const result = finalProjection({
      currentValue: 1000,
      monthlyContribution: 0,
      annualReturnPct: -12,
      years: 1,
    });
    expect(result.value).toBeCloseTo(880, 0);
  });

  it("respeita horizontes diferentes", () => {
    const one = projectPortfolio({
      currentValue: 1000,
      monthlyContribution: 100,
      annualReturnPct: 6,
      years: 1,
    });
    const ten = projectPortfolio({
      currentValue: 1000,
      monthlyContribution: 100,
      annualReturnPct: 6,
      years: 10,
    });
    expect(one.points).toHaveLength(13);
    expect(ten.points).toHaveLength(121);
    expect(ten.final.value).toBeGreaterThan(one.final.value);
  });

  it("identifica o primeiro mês em que o objetivo é atingido", () => {
    const result = goalProjection(
      { currentValue: 1000, monthlyContribution: 100, annualReturnPct: 0, maxYears: 2 },
      1500,
    );
    expect(result.reached).toBe(true);
    expect(result.month).toBe(5);
    expect(result.year).toBe(1);
  });

  it("reconhece objetivo já atingido", () => {
    const result = goalProjection(
      { currentValue: 2000, monthlyContribution: 0, annualReturnPct: 0, maxYears: 1 },
      1500,
    );
    expect(result.reached).toBe(true);
    expect(result.month).toBe(0);
  });

  it("indica quando o objetivo não é atingido no horizonte", () => {
    const result = goalProjection(
      { currentValue: 1000, monthlyContribution: 10, annualReturnPct: 0, maxYears: 1 },
      5000,
    );
    expect(result.reached).toBe(false);
    expect(result.month).toBeNull();
  });
});
