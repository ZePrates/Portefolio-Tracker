/**
 * Lógica pura das tabelas (ordenar, filtrar, paginar) — separada da interface
 * para poder ser testada. Sem dependências de React.
 */

export type SortDir = "asc" | "desc";
export type SortValue = string | number | null | undefined;

/** Texto sem acentos e em minúsculas, para pesquisas tolerantes ("acao" encontra "Ação"). */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Compara dois valores; texto à portuguesa, números por valor; vazios vão sempre para o fim. */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const cmp =
    typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b, "pt", { sensitivity: "base", numeric: true })
      : Number(a) - Number(b);
  return dir === "asc" ? cmp : -cmp;
}

export function sortRows<T>(rows: T[], valueOf: ((row: T) => SortValue) | null, dir: SortDir): T[] {
  if (!valueOf) return rows;
  // Ordenação estável: empates mantêm a ordem original.
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => compareValues(valueOf(x.row), valueOf(y.row), dir) || x.index - y.index)
    .map((x) => x.row);
}

export function filterRows<T>(rows: T[], query: string, textOf: ((row: T) => string) | null): T[] {
  const q = normalizeSearch(query);
  if (!q || !textOf) return rows;
  const terms = q.split(/\s+/);
  return rows.filter((row) => {
    const text = normalizeSearch(textOf(row));
    return terms.every((t) => text.includes(t));
  });
}

export interface Page<T> {
  rows: T[];
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
}

/** `page` é base 1 e fica sempre dentro dos limites (ex.: depois de um filtro). */
export function paginate<T>(rows: T[], page: number, pageSize: number | null): Page<T> {
  const total = rows.length;
  if (!pageSize || pageSize <= 0) {
    return { rows, page: 1, pageCount: 1, from: total === 0 ? 0 : 1, to: total, total };
  }
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return {
    rows: slice,
    page: current,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
    total,
  };
}
