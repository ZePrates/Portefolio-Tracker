import type { ReactNode } from "react";
import { ArrowLeftRight, Download, Ellipsis, History, Pencil, Trash2 } from "lucide-react";
import {
  type Asset,
  type AssetClass,
  assetCurrentValue,
  assetInvested,
  assetPL,
  assetRealizedPL,
} from "@/lib/portfolio-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDatePt, formatPercent, formatQuantity } from "@/lib/format";
import { Delta, IconButton } from "@/components/ui-bits";
import { DataTable, type Column } from "@/components/data-table";
import { cn } from "@/lib/utils";
import {
  assetSortValue as sortValue,
  isQuantityClass as isQuantityAsset,
  paysDividendsClass as paysDividends,
} from "@/lib/asset-class";
import { privateEUR, privateMoney } from "@/components/private-value";

export interface AssetRowActions {
  /** Abre a ficha (movimentos, comprar/vender, composição). */
  onOpen: (a: Asset) => void;
  onEdit: (a: Asset) => void;
  onRemove: (a: Asset) => void;
  onImportDividends: (a: Asset) => void;
  /** Ativo cujos dividendos estão a ser atualizados. */
  importingId: string | null;
}

interface TableProps extends AssetRowActions {
  assetClass: AssetClass;
  title: string;
  rows: Asset[];
  hidden: boolean;
}

/** Peças partilhadas pelas duas tabelas (nome, menu, valores com moeda original). */
function rowParts({
  assetClass,
  hidden,
  onOpen,
  onEdit,
  onRemove,
  onImportDividends,
  importingId,
}: Omit<TableProps, "title" | "rows">) {
  const showYield = assetClass === "acao_dividendo" || assetClass === "reit";
  const quantityLabel = assetClass === "metal" ? "Gramas" : assetClass === "p2p" ? "Grupo" : "Qtd.";
  const quantityText = (a: Asset) =>
    assetClass === "p2p" ? (a.p2p_group ?? "—") : a.quantity ? formatQuantity(a.quantity) : "—";

  /** Valor em EUR com a moeda original por baixo (ativos em moeda estrangeira). */
  const withNative = (eur: number, native: number | null | undefined, cur: string) => (
    <>
      {privateEUR(eur, hidden)}
      {cur !== "EUR" && native != null && (
        <span className="block whitespace-nowrap text-xs text-muted-foreground">
          {privateMoney(native, cur, hidden)}
        </span>
      )}
    </>
  );
  const rateOf = (a: Asset) =>
    a.current_price_native && a.current_price_native > 0 && a.current_price > 0
      ? a.current_price / a.current_price_native
      : 1;

  /** Nome do ativo: abre a ficha (movimentos, posição e composição). */
  const assetName = (a: Asset) => (
    <button
      type="button"
      onClick={() => onOpen(a)}
      aria-label={`Abrir a ficha de ${a.name}`}
      className="block min-w-0 max-w-[26rem] rounded text-left hover:underline hover:decoration-muted-foreground/50 hover:underline-offset-4"
    >
      <span className="block font-medium leading-snug">{a.name}</span>
      {a.ticker && <span className="block text-xs text-muted-foreground">{a.ticker}</span>}
    </button>
  );

  /** Menu "⋯" com as ações secundárias de uma linha. */
  const moreMenu = (a: Asset, closed = false) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Mais ações para ${a.name}`}>
          <Ellipsis aria-hidden className="h-4 w-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {closed ? (
          <DropdownMenuItem onSelect={() => onOpen(a)}>
            <History aria-hidden />
            Ver histórico
          </DropdownMenuItem>
        ) : (
          <>
            {paysDividends(assetClass) && a.ticker && (
              <DropdownMenuItem
                disabled={importingId === a.id}
                onSelect={() => onImportDividends(a)}
              >
                <Download aria-hidden />
                Atualizar dividendos
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onEdit(a)}>
              <Pencil aria-hidden />
              Editar
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onRemove(a)}
          className="text-destructive focus:bg-destructive/15 focus:text-destructive"
        >
          <Trash2 aria-hidden />
          Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const rowActions = (a: Asset) => (
    <div className="flex justify-end gap-1">
      {isQuantityAsset(assetClass) && (
        <IconButton label={`Comprar ou vender ${a.name}`} onClick={() => onOpen(a)}>
          <ArrowLeftRight aria-hidden className="h-4 w-4" />
        </IconButton>
      )}
      {moreMenu(a)}
    </div>
  );
  return {
    showYield,
    quantityLabel,
    quantityText,
    withNative,
    rateOf,
    assetName,
    moreMenu,
    rowActions,
  };
}

/** Posições abertas de uma classe. */
export function OpenAssetsTable(props: TableProps) {
  const { assetClass, title, rows, hidden } = props;
  const { showYield, quantityLabel, quantityText, withNative, rateOf, assetName, rowActions } =
    rowParts(props);
  const openColumns: Column<Asset>[] = [
    {
      id: "name",
      header: "Ativo",
      label: "Ativo",
      required: true,
      sortValue: (a) => sortValue(a, "name"),
      cell: assetName,
    },
    {
      id: "quantity",
      header: quantityLabel,
      align: "right",
      sortValue: (a) => sortValue(a, "quantity"),
      cell: (a) => <span className="text-muted-foreground">{quantityText(a)}</span>,
    },
    ...(isQuantityAsset(assetClass)
      ? ([
          {
            id: "buyPrice",
            header: "Preço compra",
            align: "right",
            sortValue: (a) => sortValue(a, "buyPrice"),
            cell: (a) =>
              withNative(a.average_price ?? 0, a.purchase_price_native, a.native_currency || "EUR"),
          },
          {
            id: "currentPrice",
            header: "Preço atual",
            align: "right",
            sortValue: (a) => sortValue(a, "currentPrice"),
            cell: (a) =>
              withNative(a.current_price ?? 0, a.current_price_native, a.native_currency || "EUR"),
          },
        ] satisfies Column<Asset>[])
      : []),
    {
      id: "invested",
      header: "Investido",
      align: "right",
      sortValue: (a) => sortValue(a, "invested"),
      cell: (a) =>
        withNative(assetInvested(a), assetInvested(a) / rateOf(a), a.native_currency || "EUR"),
    },
    {
      id: "value",
      header: "Valor atual",
      align: "right",
      sortValue: (a) => sortValue(a, "value"),
      cell: (a) =>
        withNative(
          assetCurrentValue(a),
          assetCurrentValue(a) / rateOf(a),
          a.native_currency || "EUR",
        ),
    },
    {
      id: "pl",
      header: "P/L",
      align: "right",
      sortValue: (a) => sortValue(a, "pl"),
      cell: (a) => {
        const p = assetPL(a);
        return (
          <span className="flex flex-col items-end">
            <Delta value={p.abs}>{privateEUR(p.abs, hidden)}</Delta>
            <span
              className={cn(
                "text-xs",
                p.abs > 0
                  ? "text-success"
                  : p.abs < 0
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              {formatPercent(p.pct)}
            </span>
          </span>
        );
      },
    },
    ...(showYield
      ? ([
          {
            id: "yield",
            header: "Yield",
            align: "right",
            sortValue: (a) => sortValue(a, "yield"),
            cell: (a) => (
              <span className="font-medium text-primary">
                {a.annual_yield == null ? "—" : formatPercent(a.annual_yield)}
              </span>
            ),
          },
        ] satisfies Column<Asset>[])
      : []),
    {
      id: "actions",
      header: <span className="sr-only">Ações</span>,
      required: true,
      cell: rowActions,
    },
  ];

  const Pair = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num font-medium">{value}</dd>
    </div>
  );

  const openCard = (a: Asset) => {
    const p = assetPL(a);
    const cur = a.native_currency || "EUR";
    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">{assetName(a)}</div>
          <div className="shrink-0 text-right">
            <p className="num font-semibold">{privateEUR(assetCurrentValue(a), hidden)}</p>
            <Delta value={p.abs} className="justify-end text-xs">
              {privateEUR(p.abs, hidden)} · {formatPercent(p.pct)}
            </Delta>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Pair label={quantityLabel} value={quantityText(a)} />
          <Pair label="Investido" value={privateEUR(assetInvested(a), hidden)} />
          {isQuantityAsset(assetClass) && (
            <>
              <Pair
                label="Preço compra"
                value={withNative(a.average_price ?? 0, a.purchase_price_native, cur)}
              />
              <Pair
                label="Preço atual"
                value={withNative(a.current_price ?? 0, a.current_price_native, cur)}
              />
            </>
          )}
          {showYield && (
            <Pair
              label="Yield"
              value={a.annual_yield == null ? "—" : formatPercent(a.annual_yield)}
            />
          )}
        </dl>
        <div className="border-t border-border/60 pt-2">{rowActions(a)}</div>
      </div>
    );
  };

  return (
    <DataTable
      rows={rows}
      columns={openColumns}
      rowKey={(a) => a.id}
      caption={`Posições abertas — ${title}`}
      storageKey={`assets:${assetClass}`}
      defaultSort={{ id: "name", dir: "asc" }}
      searchText={(a) => `${a.name} ${a.ticker ?? ""} ${a.isin ?? ""}`}
      searchPlaceholder="Pesquisar por nome, ticker ou ISIN…"
      renderCard={openCard}
    />
  );
}

/** Posições totalmente vendidas, com o P/L realizado. */
export function ClosedAssetsTable(props: TableProps) {
  const { title, rows, hidden } = props;
  const { assetName, moreMenu } = rowParts(props);
  const closedColumns: Column<Asset>[] = [
    {
      id: "name",
      header: "Ativo",
      required: true,
      sortValue: (a) => sortValue(a, "name"),
      cell: assetName,
    },
    {
      id: "realized",
      header: "P/L realizado",
      align: "right",
      sortValue: (a) => assetRealizedPL(a),
      cell: (a) => (
        <Delta value={assetRealizedPL(a)}>{privateEUR(assetRealizedPL(a), hidden)}</Delta>
      ),
    },
    {
      id: "fees",
      header: "Comissões",
      align: "right",
      sortValue: (a) => a.total_fees ?? 0,
      cell: (a) => (
        <span className="text-muted-foreground">{privateEUR(a.total_fees ?? 0, hidden)}</span>
      ),
    },
    {
      id: "closed",
      header: "Fecho",
      align: "right",
      sortValue: (a) => a.closed_at ?? "",
      cell: (a) => <span className="text-muted-foreground">{formatDatePt(a.closed_at)}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">Ações</span>,
      required: true,
      cell: (a) => <div className="flex justify-end">{moreMenu(a, true)}</div>,
    },
  ];

  const closedCard = (a: Asset) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">{assetName(a)}</div>
        <Delta value={assetRealizedPL(a)} className="shrink-0">
          {privateEUR(assetRealizedPL(a), hidden)}
        </Delta>
      </div>
      <p className="text-xs text-muted-foreground">
        Fecho {formatDatePt(a.closed_at)} · comissões {privateEUR(a.total_fees ?? 0, hidden)}
      </p>
      <div className="flex justify-end border-t border-border/60 pt-2">{moreMenu(a, true)}</div>
    </div>
  );

  return (
    <DataTable
      rows={rows}
      columns={closedColumns}
      rowKey={(a) => a.id}
      caption={`Posições fechadas — ${title}`}
      defaultSort={{ id: "closed", dir: "desc" }}
      renderCard={closedCard}
    />
  );
}
