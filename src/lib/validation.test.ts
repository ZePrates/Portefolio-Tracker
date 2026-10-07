import { describe, expect, it } from "vitest";
import { currencyCode, isoDate, tradeDate } from "./validation";

describe("validation", () => {
  it("isoDate aceita datas reais e rejeita inválidas", () => {
    expect(isoDate.safeParse("2026-02-28").success).toBe(true);
    expect(isoDate.safeParse("2026-02-30").success).toBe(false);
    expect(isoDate.safeParse("abc").success).toBe(false);
    expect(isoDate.safeParse("07/10/2026").success).toBe(false);
  });

  it("tradeDate rejeita datas futuras", () => {
    expect(tradeDate.safeParse("2999-01-01").success).toBe(false);
    expect(tradeDate.safeParse("2025-01-01").success).toBe(true);
  });

  it("currencyCode normaliza para maiúsculas", () => {
    expect(currencyCode.parse(" usd ")).toBe("USD");
    expect(currencyCode.safeParse("dollar").success).toBe(false);
  });
});
