import { describe, expect, it } from "vitest";
import { excelSerialToDate, readXlsx } from "./xlsx";
import { buildXlsx } from "./xlsx-test-utils";

describe("readXlsx", () => {
  it("lê texto partilhado, texto em linha, números e células em falta", () => {
    const bytes = buildXlsx(
      {
        Folha: [
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>a &amp; b</t></is></c></row>',
          '<row r="2"><c r="A2"><v>-12.5</v></c><c r="B2" t="s"><v>1</v></c></row>',
        ].join(""),
      },
      ["Type", "Olá"],
    );
    expect(readXlsx(bytes)).toEqual({
      Folha: [
        ["Type", null, "a & b"],
        ["-12.5", "Olá"],
      ],
    });
  });

  it("recusa ficheiros que não são Excel", () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow(/Excel/);
  });
});

describe("excelSerialToDate", () => {
  it("converte o número de série (UTC)", () => {
    expect(excelSerialToDate(46310.5).toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });
});
