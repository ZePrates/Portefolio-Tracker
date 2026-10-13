import { describe, expect, it } from "vitest";
import {
  companyNameKey,
  readableCompanyName,
  exposureEUR,
  exposurePct,
  mergeDisplaySlices,
  mergeDisplayDimensions,
  exposureCountry,
  exposureSector,
  sortExposureRows,
  managerSyncSummary,
} from "@/lib/exposure-display";
import { paginate, filterRows } from "@/lib/table";

describe("regras das listas de exposição", () => {
  it("preserva siglas e apresenta nomes das gestoras de forma legível", () => {
    expect(readableCompanyName("MICRON TECHNOLOGY")).toBe("Micron Technology");
    for (const name of ["ASML", "SAP", "AMD"]) expect(readableCompanyName(name)).toBe(name);
  });
  it("usa percentagens europeias com precisão abaixo de 1%", () => {
    expect(exposurePct(12.345).replace(/\s/g, "")).toBe("12,3%");
    expect(exposurePct(0.456).replace(/\s/g, "")).toBe("0,46%");
  });
  it("mostra euros sem decimais acima de mil e oculta valores privados", () => {
    expect(exposureEUR(1234.56).replace(/\s/g, "")).toBe("1.235€");
    expect(exposureEUR(999.56).replace(/\s/g, "")).toBe("999,56€");
    expect(exposureEUR(1234, true)).toBe("••••");
  });
  it("normaliza nomes sem pontuação, sufixos e classes A/B/C", () => {
    expect(companyNameKey("MICRON TECHNOLOGY INC. Class A")).toBe(
      companyNameKey("Micron Technology Corp"),
    );
    expect(companyNameKey("SAP SE")).toBe("sap");
    expect(companyNameKey("Company S.A.")).toBe(companyNameKey("Company NV"));
  });
  it("junta variantes de setores e soma valores, pesos e contribuições", () => {
    const slices = ["Consumer Cyclical", "Consumer Cyclicals"].map((value) => ({
      value,
      amount: 100,
      pct: 5,
      contributors: [{ assetId: "etf", name: "ETF", amount: 100 }],
    }));
    const merged = mergeDisplaySlices(slices, exposureSector);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ amount: 200, pct: 10, contributors: [{ amount: 200 }] });
    expect(exposureSector("Financial Services")).toBe(exposureSector("Finance"));
    expect(exposureSector("Consumer Defensive")).toBe(exposureSector("Consumer Non-Cyclicals"));
  });
  it("junta variantes de países", () => {
    const merged = mergeDisplaySlices(
      ["USA", "United States", "Estados Unidos"].map((value) => ({
        value,
        amount: 100,
        pct: 10,
        contributors: [],
      })),
      exposureCountry,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.pct).toBe(30);
  });
  it("junta variantes por dimensão no detalhe sem misturar país com setor", () => {
    expect(mergeDisplayDimensions([
      { dimension: "country", value: "USA", pct: 10 },
      { dimension: "country", value: "United States", pct: 20 },
      { dimension: "sector", value: "Technology", pct: 5 },
      { dimension: "sector", value: "Tecnologia", pct: 10 },
    ])).toEqual([
      { dimension: "country", value: "Estados Unidos", pct: 30 },
      { dimension: "sector", value: "Tecnologia", pct: 15 },
    ]);
  });
  it.each(["asc", "desc"] as const)("mantém Outros no fim em %s", (dir) => {
    const rows = [
      { name: "Outros", pct: 90 },
      { name: "A", pct: 1 },
      { name: "B", pct: 9 },
    ];
    expect(
      sortExposureRows(
        rows,
        (r) => r.pct,
        dir,
        (r) => r.name,
      ).at(-1)?.name,
    ).toBe("Outros");
  });
  it("por defeito top 50 e pesquisa por nome ou ticker em milhares de linhas", () => {
    const rows = Array.from({ length: 3000 }, (_, index) => ({
      name: `Company ${index}`,
      ticker: `T${index}`,
      value: index,
    }));
    const sorted = sortExposureRows(
      rows,
      (r) => r.value,
      "desc",
      (r) => r.name,
    );
    expect(paginate(sorted, 1, 50).rows).toHaveLength(50);
    expect(paginate(sorted, 1, 50).rows[0]?.value).toBe(2999);
    expect(filterRows(rows, "t2999", (r) => `${r.name} ${r.ticker}`)).toHaveLength(1);
  });
  it("resume sucessos, ETFs não suportados e erros separadamente", () => {
    const result = managerSyncSummary([
      ...Array.from({ length: 13 }, () => ({
        ticker: "ETF",
        ok: true,
        rows: 100,
        weight_sum: 1,
        as_of: null,
      })),
      ...Array.from({ length: 9 }, () => ({
        ticker: "ETF",
        ok: false,
        skipped: true,
        rows: 0,
        weight_sum: 0,
        as_of: null,
      })),
      { ticker: "ERROR", ok: false, rows: 0, weight_sum: 0, as_of: null },
    ]);
    expect(result).toEqual({ updated: 13, unsupported: 9, failed: 1 });
  });
});
