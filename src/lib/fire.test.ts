import { describe, expect, it } from "vitest";
import { fireProgress, type FireSettings } from "./fire";

const settings: FireSettings = {
  annualExpenses: 24000,
  safeWithdrawalRate: 4,
  monthlyContribution: 1000,
  expectedReturnPct: 7,
  inflationPct: 2,
};

describe("fireProgress", () => {
  it("número FIRE = despesas ÷ taxa de levantamento (regra dos 25×)", () => {
    const p = fireProgress(settings, 150000, 3000, "2026-10-07");
    expect(p.fireNumber).toBe(600000);
    expect(p.progressPct).toBeCloseTo(25);
    expect(p.remaining).toBe(450000);
    expect(p.passiveCoveragePct).toBeCloseTo(12.5);
  });

  it("usa o retorno real (nominal descontado da inflação)", () => {
    const p = fireProgress(settings, 150000, 0, "2026-10-07");
    expect(p.realReturnPct).toBeCloseTo((1.07 / 1.02 - 1) * 100, 6);
  });

  it("estima anos e mês até ao FIRE", () => {
    const p = fireProgress(settings, 150000, 0, "2026-10-07");
    // Controlo anual: 150k × 1,049^16 + 12k × (1,049^16 − 1)/0,049 ≈ 604k → ~16 anos
    expect(p.yearsToFire).toBeGreaterThan(15);
    expect(p.yearsToFire).toBeLessThan(17);
    expect(p.fireMonth).toMatch(/^204[1-3]-\d{2}$/);
  });

  it("já atingido → 0 anos; inatingível → null", () => {
    expect(fireProgress(settings, 700000, 0, "2026-10-07").yearsToFire).toBe(0);
    expect(
      fireProgress(
        { ...settings, monthlyContribution: 0, expectedReturnPct: 0, inflationPct: 2 },
        1000,
        0,
        "2026-10-07",
      ).yearsToFire,
    ).toBeNull();
  });
});
