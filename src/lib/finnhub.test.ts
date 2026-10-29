import { describe, expect, it } from "vitest";
import { parseReferenceYield } from "@/lib/finnhub";

describe("parseReferenceYield", () => {
  it("prefere o yield anual indicado e recai no TTM", () => {
    expect(
      parseReferenceYield({
        metric: { dividendYieldIndicatedAnnual: 4.66, currentDividendYieldTTM: 4.1 },
      }),
    ).toBe(4.66);
    expect(parseReferenceYield({ metric: { currentDividendYieldTTM: 4.1 } })).toBe(4.1);
  });

  it("0 é válido (sem dividendo); valores absurdos ou em falta são null", () => {
    expect(parseReferenceYield({ metric: { dividendYieldIndicatedAnnual: 0 } })).toBe(0);
    expect(parseReferenceYield({ metric: { dividendYieldIndicatedAnnual: 250 } })).toBeNull();
    expect(parseReferenceYield({ metric: {} })).toBeNull();
    expect(parseReferenceYield({ error: "You don't have access to this resource." })).toBeNull();
    expect(parseReferenceYield(null)).toBeNull();
  });
});
