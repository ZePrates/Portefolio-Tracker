import { describe, expect, it } from "vitest";
import { canCompareEtfs, equityHolding } from "./etf-sheet";
describe("ETF sheet overlap eligibility", () => {
  it("compares only two full lists", () => {
    expect(canCompareEtfs("full", "full")).toBe(true);
  });
  it.each(["partial", "error", null])("excludes %s lists in either direction", (status) => {
    expect(canCompareEtfs("full", status)).toBe(false);
    expect(canCompareEtfs(status, "full")).toBe(false);
  });
  it("excludes cash and derivatives from company overlap", () => {
    expect(equityHolding({ assetClass: "Cash and/or Derivatives" })).toBe(false);
    expect(equityHolding({ assetClass: "Equity" })).toBe(true);
    expect(equityHolding({ assetClass: null })).toBe(true);
  });
});
