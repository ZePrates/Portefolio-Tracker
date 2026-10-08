import { describe, expect, it } from "vitest";
import { compareValues, filterRows, normalizeSearch, paginate, sortRows } from "./table";

describe("normalizeSearch", () => {
  it("ignora acentos e maiúsculas", () => {
    expect(normalizeSearch("  Ações Dividendos ")).toBe("acoes dividendos");
  });
});

describe("sortRows", () => {
  const rows = [
    { n: "b", v: 2 },
    { n: "ã", v: null },
    { n: "a", v: 10 },
    { n: "c", v: 2 },
  ];

  it("ordena números e põe vazios no fim, nos dois sentidos", () => {
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.n)).toEqual(["b", "c", "a", "ã"]);
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.n)).toEqual(["a", "b", "c", "ã"]);
  });

  it("ordena texto à portuguesa (ã junto do a)", () => {
    // a e ã contam como iguais (sensibilidade base) e ficam antes de b e c
    const names = sortRows(rows, (r) => r.n, "asc").map((r) => r.n);
    expect(names.slice(0, 2).sort()).toEqual(["a", "ã"]);
    expect(names.slice(2)).toEqual(["b", "c"]);
  });

  it("é estável e não altera o original", () => {
    const copy = [...rows];
    sortRows(rows, (r) => r.v, "asc");
    expect(rows).toEqual(copy);
    expect(sortRows(rows, null, "asc")).toBe(rows);
  });

  it("compara números como números (2 < 10)", () => {
    expect(compareValues(2, 10, "asc")).toBeLessThan(0);
    expect(compareValues("item 2", "item 10", "asc")).toBeLessThan(0);
  });
});

describe("filterRows", () => {
  const rows = [
    { t: "iShares Core MSCI World" },
    { t: "Vanguard FTSE All-World" },
    { t: "Realty Income Corporation" },
  ];
  const text = (r: { t: string }) => r.t;

  it("filtra por todos os termos, sem acentos", () => {
    expect(filterRows(rows, "world ishares", text)).toHaveLength(1);
    expect(filterRows(rows, "WORLD", text)).toHaveLength(2);
    expect(filterRows(rows, "", text)).toBe(rows);
    expect(filterRows(rows, "xyz", text)).toHaveLength(0);
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 53 }, (_, i) => i + 1);

  it("divide em páginas e limita a página pedida", () => {
    const p = paginate(rows, 2, 25);
    expect(p).toMatchObject({ page: 2, pageCount: 3, from: 26, to: 50, total: 53 });
    expect(p.rows[0]).toBe(26);
    expect(paginate(rows, 99, 25)).toMatchObject({ page: 3, from: 51, to: 53 });
    expect(paginate(rows, -4, 25).page).toBe(1);
  });

  it("sem pageSize devolve tudo; lista vazia não parte", () => {
    expect(paginate(rows, 1, null).rows).toHaveLength(53);
    expect(paginate([], 1, 25)).toMatchObject({ pageCount: 1, from: 0, to: 0, total: 0 });
  });
});
