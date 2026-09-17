import { describe, expect, it } from "vitest";
import { detectManager } from "@/lib/exposure-providers/manager-detect";

const input = (fundFamily: string | null, name = "") => ({
  isin: null,
  ticker: null,
  name,
  fundFamily,
});

describe("detectManager", () => {
  it("reconhece iShares pelo fundFamily", () => {
    expect(detectManager(input("iShares"))).toBe("ishares");
  });

  it("reconhece BlackRock como iShares", () => {
    expect(detectManager(input("BlackRock Asset Management"))).toBe("ishares");
  });

  it("reconhece Vanguard", () => {
    expect(detectManager(input("Vanguard"))).toBe("vanguard");
  });

  it("reconhece VanEck", () => {
    expect(detectManager(input("VanEck"))).toBe("vaneck");
  });

  it("reconhece WisdomTree", () => {
    expect(detectManager(input("WisdomTree"))).toBe("wisdomtree");
  });

  it("reconhece Xtrackers/DWS", () => {
    expect(detectManager(input("DWS Xtrackers"))).toBe("xtrackers");
    expect(detectManager(input(null, "Xtrackers Euro Stoxx 50 UCITS ETF"))).toBe("xtrackers");
  });

  it("reconhece BNP Paribas", () => {
    expect(detectManager(input("BNP Paribas Asset Management"))).toBe("bnpparibas");
  });

  it("devolve null quando não há gestora reconhecida", () => {
    expect(detectManager(input("Invesco"))).toBeNull();
    expect(detectManager(input(null))).toBeNull();
  });

  it("usa o nome como segunda fonte quando fundFamily é null", () => {
    expect(detectManager(input(null, "iShares Core MSCI World UCITS ETF"))).toBe("ishares");
  });
});
