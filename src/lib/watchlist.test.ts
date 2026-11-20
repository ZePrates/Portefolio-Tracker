import { describe, expect, it } from "vitest";
import { isBelowTarget, targetGap } from "./watchlist";

describe("targetGap / isBelowTarget", () => {
  it("distância ao alvo em fração (negativa abaixo do alvo)", () => {
    expect(targetGap(95, 100)).toBeCloseTo(-0.05, 10);
    expect(targetGap(110, 100)).toBeCloseTo(0.1, 10);
    expect(targetGap(100, 100)).toBe(0);
  });

  it("sem alvo, sem preço ou valores inválidos não há distância", () => {
    expect(targetGap(100, null)).toBeNull();
    expect(targetGap(null, 100)).toBeNull();
    expect(targetGap(100, 0)).toBeNull();
    expect(targetGap(0, 100)).toBeNull();
    expect(targetGap(Number.NaN, 100)).toBeNull();
  });

  it("abaixo do alvo é estritamente abaixo", () => {
    expect(isBelowTarget(99.99, 100)).toBe(true);
    expect(isBelowTarget(100, 100)).toBe(false);
    expect(isBelowTarget(101, 100)).toBe(false);
    expect(isBelowTarget(50, null)).toBe(false);
  });
});
