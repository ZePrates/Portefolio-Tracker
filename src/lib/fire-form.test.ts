import { describe, expect, it } from "vitest";
import { FIRE_DEFAULTS, validateFire } from "./fire-form";

describe("validateFire", () => {
  it("aceita valores à portuguesa", () => {
    expect(validateFire({ ...FIRE_DEFAULTS, annualExpenses: "24.000,50" })).toEqual({});
    expect(
      validateFire({ ...FIRE_DEFAULTS, annualExpenses: "24 000", expectedReturnPct: "5,5" }),
    ).toEqual({});
  });

  it("exige despesas anuais positivas", () => {
    expect(validateFire(FIRE_DEFAULTS).annualExpenses).toMatch(/despesas/);
    expect(validateFire({ ...FIRE_DEFAULTS, annualExpenses: "0" }).annualExpenses).toBeDefined();
    expect(validateFire({ ...FIRE_DEFAULTS, annualExpenses: "abc" }).annualExpenses).toBeDefined();
  });

  it("respeita os limites do servidor", () => {
    const ok = { ...FIRE_DEFAULTS, annualExpenses: "20000" };
    expect(validateFire({ ...ok, safeWithdrawalRate: "0" }).safeWithdrawalRate).toBeDefined();
    expect(validateFire({ ...ok, safeWithdrawalRate: "11" }).safeWithdrawalRate).toBeDefined();
    expect(validateFire({ ...ok, monthlyContribution: "-1" }).monthlyContribution).toBeDefined();
    expect(validateFire({ ...ok, expectedReturnPct: "50" }).expectedReturnPct).toBeDefined();
    expect(validateFire({ ...ok, inflationPct: "30" }).inflationPct).toBeDefined();
  });
});
