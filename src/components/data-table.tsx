import { useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Rows3,
  Search,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button, EmptyState, IconButton, TextInput } from "@/components/ui-bits";
import { usePersistentState } from "@/lib/use-persistent-state";
import { filterRows, paginate, sortRows, type SortDir, type SortValue } from "@/lib/table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  id: string;
  /** Cabeçalho na tabela (e nome na lista de colunas, se `label` não existir). */
  header: ReactNode;
  /** Nome em texto simples (lista de colunas). */
  label?: string;
  cell: (row: T) => ReactNode;
  /** Se existir, a coluna é ordenável. */
  sortValue?: (row: T) => SortValue;
  align?: "left" | "right";
  /** A coluna não pode ser escondida (ex.: nome e ações). */
  required?: boolean;
  /** Começa escondida (o utilizador pode mostrá-la). */
  defaultHidden?: boolean;
  /** Classes extra para as células (ex.: largura mínima). */
  className?: string;
}

interface Prefs {
  hidden: string[];
  density: "comfortable" | "compact";
}

/**
 * Tabela de dados: cabeçalho fixo, ordenação acessível (`aria-sort`), pesquisa,
 * colunas configuráveis, densidade e paginação. Em ecrãs pequenos mostra
 * cartões (`renderCard`) em vez de uma tabela com scroll horizontal.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  renderCard,
  storageKey,
  defaultSort,
  searchText,
  searchPlaceholder = "Pesquisar…",
  pageSize,
  emptyTitle = "Sem resultados",
  emptyDescription = "Nenhum registo corresponde à pesquisa.",
  toolbar,
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Descrição da tabela para leitores de ecrã. */
  caption: string;
  renderCard: (row: T) => ReactNode;
  /** Chave para guardar colunas e densidade neste browser. */
  storageKey?: string;
  defaultSort?: { id: string; dir: SortDir };
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Controlos extra à direita da barra de ferramentas. */
  toolbar?: ReactNode;
  className?: string;
}) {
  const searchId = useId();
  const [prefs, setPrefs] = usePersistentState<Prefs>(
    storageKey ? `pt-table:${storageKey}` : undefined,
    {
      hidden: columns.filter((c) => c.defaultHidden).map((c) => c.id),
      density: "comfortable",
    },
  );
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(defaultSort ?? null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const visible = columns.filter((c) => c.required || !prefs.hidden.includes(c.id));
  const sortColumn = sort ? columns.find((c) => c.id === sort.id) : undefined;

  const processed = useMemo(() => {
    const filtered = filterRows(rows, query, searchText ?? null);
    return sortRows(filtered, sortColumn?.sortValue ?? null, sort?.dir ?? "asc");
  }, [rows, query, searchText, sortColumn, sort?.dir]);

  // Volta à primeira página quando a pesquisa ou a ordenação mudam.
  useEffect(() => setPage(1), [query, sort, rows.length]);

  const pageData = paginate(processed, page, pageSize ?? null);
  const compact = prefs.density === "compact";

  const toggleSort = (col: Column<T>) => {
    if (!col.sortValue) return;
    setSort((s) =>
      s?.id === col.id
        ? { id: col.id, dir: s.dir === "asc" ? "desc" : "asc" }
        : { id: col.id, dir: col.align === "right" ? "desc" : "asc" },
    );
  };

  const toggleColumn = (id: string) =>
    setPrefs((p) => ({
      ...p,
      hidden: p.hidden.includes(id) ? p.hidden.filter((h) => h !== id) : [...p.hidden, id],
    }));

  const configurable = columns.filter((c) => !c.required);
  const showToolbar = !!searchText || configurable.length > 0 || !!toolbar;

  return (
    <div className={cn("space-y-3", className)}>
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {searchText && (
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor={searchId} className="sr-only">
                Pesquisar na tabela
              </label>
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <TextInput
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                autoComplete="off"
                className="pl-9"
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {processed.length === rows.length
              ? `${rows.length} ${rows.length === 1 ? "registo" : "registos"}`
              : `${processed.length} de ${rows.length} registos`}
          </p>
          <div className="ml-auto flex items-center gap-1">
            {toolbar}
            <IconButton
              label={compact ? "Densidade confortável" : "Densidade compacta"}
              aria-pressed={compact}
              className="hidden md:inline-flex"
              onClick={() =>
                setPrefs((p) => ({
                  ...p,
                  density: p.density === "compact" ? "comfortable" : "compact",
                }))
              }
            >
              <Rows3 aria-hidden className="h-4 w-4" />
            </IconButton>
            {configurable.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <IconButton label="Escolher colunas" className="hidden md:inline-flex">
                    <Columns3 aria-hidden className="h-4 w-4" />
                  </IconButton>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56">
                  <fieldset>
                    <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Colunas visíveis
                    </legend>
                    <ul className="space-y-1.5">
                      {configurable.map((c) => (
                        <li key={c.id}>
                          <label className="flex cursor-pointer items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-primary"
                              checked={!prefs.hidden.includes(c.id)}
                              onChange={() => toggleColumn(c.id)}
                            />
                            {c.label ?? (typeof c.header === "string" ? c.header : c.id)}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      )}

      {processed.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {/* Desktop: tabela com cabeçalho fixo */}
          <div className="hidden max-h-[calc(100dvh-14rem)] overflow-auto rounded-xl border border-border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--color-border)]">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  {visible.map((c) => {
                    const active = sort?.id === c.id;
                    return (
                      <th
                        key={c.id}
                        scope="col"
                        aria-sort={
                          active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined
                        }
                        className={cn(
                          "font-medium",
                          compact ? "px-3 py-2" : "px-4 py-3",
                          c.align === "right" && "text-right",
                          c.className,
                        )}
                      >
                        {c.sortValue ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(c)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded uppercase tracking-wider transition-colors hover:text-foreground",
                              c.align === "right" && "justify-end",
                              active && "text-foreground",
                            )}
                          >
                            {c.header}
                            {active ? (
                              sort?.dir === "asc" ? (
                                <ArrowUp aria-hidden className="h-3 w-3" />
                              ) : (
                                <ArrowDown aria-hidden className="h-3 w-3" />
                              )
                            ) : (
                              <ArrowUpDown aria-hidden className="h-3 w-3 opacity-40" />
                            )}
                          </button>
                        ) : (
                          c.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pageData.rows.map((row) => (
                  <tr key={rowKey(row)} className="border-t border-border/60 hover:bg-accent/40">
                    {visible.map((c) => (
                      <td
                        key={c.id}
                        className={cn(
                          compact ? "px-3 py-1.5" : "px-4 py-3",
                          c.align === "right" && "num whitespace-nowrap text-right",
                          c.className,
                        )}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cartões */}
          <ul className="space-y-3 md:hidden" aria-label={caption}>
            {pageData.rows.map((row) => (
              <li key={rowKey(row)} className="min-w-0 rounded-xl border border-border bg-card p-4">
                {renderCard(row)}
              </li>
            ))}
          </ul>

          {pageData.pageCount > 1 && (
            <nav
              aria-label="Paginação"
              className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
            >
              <p aria-live="polite">
                {pageData.from}–{pageData.to} de {pageData.total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(pageData.page - 1)}
                  disabled={pageData.page <= 1}
                  aria-label="Página anterior"
                >
                  <ChevronLeft aria-hidden className="h-4 w-4" />
                  Anterior
                </Button>
                <span className="num">
                  Página {pageData.page} de {pageData.pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(pageData.page + 1)}
                  disabled={pageData.page >= pageData.pageCount}
                  aria-label="Página seguinte"
                >
                  Seguinte
                  <ChevronRight aria-hidden className="h-4 w-4" />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
