import { describe, expect, it } from "vitest";
import { parseHistoryCsv } from "@/lib/snapshot-import";

const TODAY = "2026-10-14";

describe("parseHistoryCsv", () => {
  it("lê cabeçalho, datas PT e ISO e números PT", () => {
    const r = parseHistoryCsv(
      "data;investido;valor\n19/02/2024;749,46;749,46\n2025-05-19;4 768,87;5.199,68\n",
      TODAY,
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { date: "2024-02-19", invested: 749.46, value: 749.46 },
      { date: "2025-05-19", invested: 4768.87, value: 5199.68 },
    ]);
  });

  it("aceita vírgula como separador com números em formato EN", () => {
    const r = parseHistoryCsv("2026-08-19,8235.34,11271.27", TODAY);
    expect(r.rows).toEqual([{ date: "2026-08-19", invested: 8235.34, value: 11271.27 }]);
  });

  it("reporta linhas inválidas, datas futuras e ignora duplicados (fica a última)", () => {
    const r = parseHistoryCsv(
      "2026-01-19;100;110\n31/02/2026;1;1\n2026-01-19;100;120\n2027-01-01;1;1\n2026-03-01;abc;1",
      TODAY,
    );
    expect(r.rows).toEqual([{ date: "2026-01-19", invested: 100, value: 120 }]);
    expect(r.errors).toHaveLength(3);
  });
});

describe("parseHistoryCsv — ficheiros do Excel", () => {
  it("ignora o BOM e linhas vazias", () => {
    const r = parseHistoryCsv(
      "﻿data;investido;valor\r\n\r\n2026-08-19;8235,34;11271,27\r\n",
      TODAY,
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });
});
