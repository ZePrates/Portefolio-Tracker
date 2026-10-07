import { describe, expect, it } from "vitest";
import { currencyCode, isinCode, isoDate, tradeDate } from "./validation";

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

describe("isinCode", () => {
  it("aceita ISINs reais e normaliza para maiúsculas", () => {
    expect(isinCode.parse("ie00bk5bqt80")).toBe("IE00BK5BQT80");
    expect(isinCode.safeParse("US0378331005").success).toBe(true);
  });

  it("rejeita formatos inválidos", () => {
    expect(isinCode.safeParse("IE00BK5BQT8X").success).toBe(false);
    expect(isinCode.safeParse("VWCE").success).toBe(false);
  });
});
