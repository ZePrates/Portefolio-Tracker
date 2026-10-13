import { describe, expect, it } from "vitest";
import { etfOverlap } from "./overlap";

describe("etfOverlap", () => {
  it("uses ISIN before ticker, then ticker before normalized name", () => {
    const pairs = etfOverlap([
      {
        assetId: "a",
        name: "A",
        holdings: [
          { name: "Old name", isin: "US0378331005", symbol: "OLD", weight: 0.1 },
          { name: "Different name", symbol: "msft", weight: 0.06 },
          { name: "Alphabet Inc Class A", weight: 0.04 },
        ],
      },
      {
        assetId: "b",
        name: "B",
        holdings: [
          { name: "New name", isin: "US0378331005", symbol: "NEW", weight: 0.08 },
          { name: "Microsoft", symbol: "MSFT", weight: 0.07 },
          { name: "ALPHABET CORPORATION CLASS C", weight: 0.03 },
        ],
      },
    ]);
    expect(pairs[0]?.overlap).toBeCloseTo(0.17);
    expect(pairs[0]?.commonCount).toBe(3);
  });
  it("does not match conflicting ISINs just because tickers coincide", () => {
    const pairs = etfOverlap([
      {
        assetId: "a",
        name: "A",
        holdings: [{ name: "Apple", isin: "US0378331005", symbol: "SAME", weight: 0.1 }],
      },
      {
        assetId: "b",
        name: "B",
        holdings: [{ name: "Apple", isin: "US5949181045", symbol: "SAME", weight: 0.2 }],
      },
    ]);
    expect(pairs[0]?.overlap).toBe(0);
    expect(pairs[0]?.commonCount).toBe(0);
  });
  const world = {
    assetId: "vwce",
    name: "All-World",
    holdings: [
      { name: "Apple Inc", weight: 0.05 },
      { name: "Microsoft Corp", weight: 0.045 },
      { name: "Alphabet Inc Class A", weight: 0.012 },
      { name: "Alphabet Inc Class C", weight: 0.01 },
      { name: "Nestle SA", weight: 0.005 },
    ],
  };
  const sp500 = {
    assetId: "vuaa",
    name: "S&P 500",
    holdings: [
      { name: "APPLE INC.", weight: 0.07 },
      { name: "Microsoft Corporation", weight: 0.065 },
      { name: "Alphabet Inc", weight: 0.04 },
    ],
  };
  const europe = {
    assetId: "meud",
    name: "Europe",
    holdings: [{ name: "Nestlé", isin: "CH0038863350", weight: 0.03 }],
  };

  it("soma o mínimo dos pesos das empresas comuns (nomes normalizados)", () => {
    const [top] = etfOverlap([world, sp500]);
    // Apple 0,05 + Microsoft 0,045 + Alphabet (A+C = 0,022 vs 0,04) 0,022
    expect(top!.overlap).toBeCloseTo(0.117);
    expect(top!.commonCount).toBe(3);
    expect(top!.top[0]!.name).toBe("Apple Inc");
  });

  it("ordena pares pela sobreposição e ignora ETFs sem holdings", () => {
    const pairs = etfOverlap([world, sp500, europe, { assetId: "x", name: "Vazio", holdings: [] }]);
    expect(pairs).toHaveLength(3);
    expect(pairs[0]!.a).toBe("vwce");
    expect(pairs[0]!.b).toBe("vuaa");
  });
});
