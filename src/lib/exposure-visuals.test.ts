import { describe, expect, it } from "vitest";
import { countryRegion, countryFlag, regionSlices } from "./exposure-visuals";
describe("ETF geography", () => {
  it.each([
    ["United States", "Estados Unidos"],
    ["Germany", "Europa (excl. Reino Unido)"],
    ["Reino Unido", "Reino Unido"],
    ["Japan", "Japão"],
    ["Hong Kong", "Pacífico desenvolvido"],
    ["Australia", "Pacífico desenvolvido"],
    ["Singapore", "Pacífico desenvolvido"],
    ["New Zealand", "Pacífico desenvolvido"],
    ["Canada", "Canadá"],
    ["China", "Mercados emergentes"],
    ["Taiwan", "Mercados emergentes"],
    ["India", "Mercados emergentes"],
    ["South Korea", "Mercados emergentes"],
    ["Brazil", "Mercados emergentes"],
    ["Unknown", "Outros"],
  ])("groups %s as %s", (country, region) => expect(countryRegion(country)).toBe(region));
  it("merges amounts, percentages and contributors without loss", () => {
    const rows = regionSlices([
      {
        value: "Germany",
        pct: 20,
        amount: 200,
        contributors: [{ assetId: "a", name: "ETF", amount: 200 }],
      },
      {
        value: "France",
        pct: 10,
        amount: 100,
        contributors: [{ assetId: "a", name: "ETF", amount: 100 }],
      },
    ]);
    expect(rows).toEqual([
      {
        value: "Europa (excl. Reino Unido)",
        pct: 30,
        amount: 300,
        contributors: [{ assetId: "a", name: "ETF", amount: 300 }],
      },
    ]);
  });
  it("recognizes translated country and code flags", () => {
    expect(countryFlag("Estados Unidos")).toBe("🇺🇸");
    expect(countryFlag("GB")).toBe("🇬🇧");
  });
});
