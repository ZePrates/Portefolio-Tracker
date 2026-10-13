import { useId, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button, IconButton, SelectInput, TextInput } from "@/components/ui-bits";
import { filterRows, paginate, type SortDir, type SortValue } from "@/lib/table";
import { sortExposureRows } from "@/lib/exposure-display";
import { cn } from "@/lib/utils";

export interface ExposureColumn<T> {
  id: string;
  label: string;
  cell: (row: T) => ReactNode;
  value: (row: T) => SortValue;
  numeric?: boolean;
}

export function ExposureTable<T>({
  rows,
  columns,
  label,
  rowKey,
  rowLabel,
  searchText,
  pageSize = 50,
}: {
  rows: T[];
  columns: ExposureColumn<T>[];
  label: string;
  rowKey: (row: T) => string;
  rowLabel: (row: T) => string;
  searchText?: (row: T) => string;
  pageSize?: number;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [sort, setSort] = useState<{ id: string; dir: SortDir }>({
    id: columns.at(-1)?.id ?? "",
    dir: "desc",
  });
  const processed = useMemo(() => {
    const col = columns.find((c) => c.id === sort.id);
    const filtered = filterRows(rows, query, searchText ?? null);
    return sortExposureRows(filtered, col?.value ?? rowLabel, sort.dir, rowLabel);
  }, [rows, query, searchText, columns, sort, rowLabel]);
  const current = paginate(processed, page, size);
  return (
    <div className="min-w-0 space-y-3">
      {searchText && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-sm">
            <label className="sr-only" htmlFor={id}>
              Pesquisar {label}
            </label>
            <Search
              aria-hidden
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <TextInput
              id={id}
              type="search"
              placeholder="Pesquisar nome ou ticker…"
              className="pl-9"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {processed.length.toLocaleString("pt-PT")} registos
          </span>
          <SelectInput
            className="w-auto sm:ml-auto"
            aria-label={`Linhas por página — ${label}`}
            value={size}
            onChange={(e) => {
              setSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </SelectInput>
        </div>
      )}
      <div className="max-h-[36rem] max-w-full overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">{label}</caption>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border">
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={
                    sort.id === col.id ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                  }
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground",
                    col.numeric && "text-right",
                  )}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-0 text-xs"
                    onClick={() => {
                      setSort({
                        id: col.id,
                        dir: sort.id === col.id && sort.dir === "desc" ? "asc" : "desc",
                      });
                      setPage(1);
                    }}
                  >
                    {col.label}
                    {sort.id === col.id ? (
                      sort.dir === "desc" ? (
                        <ArrowDown aria-hidden className="h-3 w-3" />
                      ) : (
                        <ArrowUp aria-hidden className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown aria-hidden className="h-3 w-3 opacity-50" />
                    )}
                  </Button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {current.rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border/50 last:border-0 hover:bg-accent/30"
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn("px-3 py-2.5", col.numeric && "num whitespace-nowrap text-right")}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!processed.length && (
          <p className="p-6 text-center text-sm text-muted-foreground">Sem resultados</p>
        )}
      </div>
      {current.pageCount > 1 && (
        <nav
          aria-label={`Paginação — ${label}`}
          className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
        >
          <span className="num" aria-live="polite">
            {current.from}–{current.to} de {current.total}
          </span>
          <div className="flex items-center gap-2">
            <IconButton
              label={`Página anterior — ${label}`}
              disabled={current.page <= 1}
              onClick={() => setPage(current.page - 1)}
            >
              <ChevronLeft aria-hidden className="h-4 w-4" />
            </IconButton>
            <span className="num">
              {current.page} / {current.pageCount}
            </span>
            <IconButton
              label={`Página seguinte — ${label}`}
              disabled={current.page >= current.pageCount}
              onClick={() => setPage(current.page + 1)}
            >
              <ChevronRight aria-hidden className="h-4 w-4" />
            </IconButton>
          </div>
        </nav>
      )}
    </div>
  );
}
