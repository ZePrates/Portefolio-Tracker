import { describe, expect, it } from "vitest";
import { portfolioIntelligence } from "@/lib/intelligence";
import type { AssetClass } from "@/lib/portfolio-types";
const a = (id: string, v: number, c: AssetClass) => ({
  id,
  user_id: "u",
  class: c,
  name: id,
  ticker: null,
  quantity: 1,
  average_price: v,
  current_price: v,
  invested_amount: v,
  current_value: v,
  currency: "EUR",
  metal_type: null,
  p2p_group: null,
  annual_yield: null,
  notes: null,
  native_currency: "EUR",
  purchase_price_native: v,
  current_price_native: v,
  dividend_frequency: null,
  last_dividend_import: null,
  status: "open",
  realized_pl: 0,
  total_fees: 0,
  closed_at: null,
  created_at: "",
  updated_at: "",
});
describe("portfolio intelligence", () =>
  it("gera score e riscos", () => {
    const r = portfolioIntelligence([a("A", 900, "etf"), a("B", 100, "reit")]);
    expect(r.score).toBeLessThan(100);
    expect(r.risks.length).toBeGreaterThan(0);
  }));

describe("exposure coverage", () =>
  it("sinaliza cobertura incompleta e reduz a confiança do score", () => {
    const r = portfolioIntelligence([a("A", 900, "etf"), a("B", 100, "reit")], {
      total: 1000,
      byClass: [],
      country: [],
      region: [],
      continent: [],
      development: [],
      sector: [],
      industry: [],
      currency: [],
      companies: [],
      concentration: {
        largest: 90,
        top5: 100,
        top10: 100,
        topCountry: 0,
        topSector: 0,
        topCurrency: 0,
      },
      coverage: 70,
    });
    expect(r.metrics.coverage).toBe(70);
    expect(r.risks.some((x) => x.includes("cobertura de 70.0%"))).toBe(true);
    expect(r.recommendations.some((x) => x.includes("dados de exposição"))).toBe(true);
  }));
