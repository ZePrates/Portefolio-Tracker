import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Pencil, Trash2, RefreshCw, Search, Download, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import {
  type Asset,
  type AssetClass,
  assetCurrentValue,
  assetInvested,
  assetPL,
  assetRealizedPL,
  isOpenPosition,
} from "@/lib/portfolio-types";
import { AssetPositionModal } from "@/components/asset-position-modal";
import {
  listAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  buyAsset,
} from "@/lib/portfolio.functions";
import { updateAllPrices, lookupTicker } from "@/lib/prices.functions";
import { syncDividendsForAsset } from "@/lib/dividends.functions";

import {
  formatDatePt,
  formatEUR,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  parseNumberOr,
} from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import {
  PageHeader,
  MetricCard,
  EmptyState,
  ErrorState,
  Button,
  Delta,
  IconButton,
  Modal,
  Field,
  SelectInput,
  TextInput,
  useConfirm,
} from "@/components/ui-bits";
import { DataTable, type Column } from "@/components/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { todayLisbon } from "@/lib/dates";
import { validateAssetForm, type AssetFormValues } from "@/lib/asset-form";
import {
  assetSortValue,
  isQuantityClass,
  isSecurityClass,
  paysDividendsClass,
} from "@/lib/asset-class";

interface Props {
  assetClass: AssetClass;
  title: string;
  subtitle: string;
  emptyLabel?: string;
}

interface FormState {
  name: string;
  ticker: string;
  isin: string;
  quantity: string;
  purchase_price: string;
  purchase_date: string;
  current_price: string;
  invested_amount: string;
  current_value: string;
  metal_type: string;
  p2p_group: string;
  annual_yield: string;
  currency: string;
  frequency: string;
}

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "CAD"];
const today = () => todayLisbon();

function defaultCurrency(c: AssetClass) {
  return c === "etf" ? "EUR" : "USD";
}

function emptyForm(c: AssetClass): FormState {
  return {
    name: "",
    ticker: "",
    isin: "",
    quantity: "",
    purchase_price: "",
    purchase_date: today(),
    current_price: "",
    invested_amount: "",
    current_value: "",
    metal_type: "Ouro",
    p2p_group: "A",
    annual_yield: "",
    currency: defaultCurrency(c),
    frequency: "",
  };
}

function num(s: string): number {
  return parseNumberOr(s, 0);
}

const isSecurity = isSecurityClass;
const isQuantityAsset = isQuantityClass;
const paysDividends = paysDividendsClass;
const sortValue = assetSortValue;

export function AssetClassPage({ assetClass, title, subtitle, emptyLabel }: Props) {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const fetchAssets = useServerFn(listAssets);
  const createFn = useServerFn(createAsset);
  const buyFn = useServerFn(buyAsset);
  const updateFn = useServerFn(updateAsset);
  const deleteFn = useServerFn(deleteAsset);
  const refreshFn = useServerFn(updateAllPrices);
  const lookupFn = useServerFn(lookupTicker);
  const syncDivFn = useServerFn(syncDividendsForAsset);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(assetClass));
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [looking, setLooking] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [positionAsset, setPositionAsset] = useState<Asset | null>(null);
  const [fxRate, setFxRate] = useState<number>(1);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const {
    data: allAssets,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetchAssets(),
  });

  const classAssets = useMemo(
    () => ((allAssets ?? []) as Asset[]).filter((a) => a.class === assetClass),
    [allAssets, assetClass],
  );
  const assets = useMemo(() => classAssets.filter(isOpenPosition), [classAssets]);
  const closedAssets = useMemo(() => classAssets.filter((a) => !isOpenPosition(a)), [classAssets]);

  const realizedTotal = classAssets.reduce((s, a) => s + assetRealizedPL(a), 0);

  const totals = assets.reduce(
    (acc, a) => {
      acc.invested += assetInvested(a);
      acc.current += assetCurrentValue(a);
      return acc;
    },
    { invested: 0, current: 0 },
  );
  const pl = totals.current - totals.invested;
  const plPct = totals.invested > 0 ? (pl / totals.invested) * 100 : 0;
  const yields = assets
    .map((asset) => asset.annual_yield)
    .filter((value): value is number => value != null);
  const averageYield =
    yields.length > 0 ? yields.reduce((sum, value) => sum + value, 0) / yields.length : null;
  const lastPriceUpdate = assets.reduce<string | null>(
    (acc, a) =>
      a.price_updated_at && (!acc || a.price_updated_at > acc) ? a.price_updated_at : acc,
    null,
  );

  const formErrors = useMemo(
    () =>
      validateAssetForm(form, {
        quantityAsset: isQuantityAsset(assetClass),
        editing: !!editing,
        isEtf: assetClass === "etf",
        today: today(),
      }),
    [form, assetClass, editing],
  );
  const err = (k: keyof AssetFormValues) => (touched[k] ? formErrors[k] : undefined);
  const touch = (k: keyof AssetFormValues) => () => setTouched((t) => ({ ...t, [k]: true }));

  const openCreate = () => {
    setTouched({});
    setEditing(null);
    setForm(emptyForm(assetClass));
    setFxRate(1);
    setDialogOpen(true);
  };

  const openEdit = (a: Asset) => {
    setTouched({});
    setEditing(a);
    const cur = a.native_currency || "EUR";
    const rate =
      a.current_price_native && a.current_price_native > 0 && a.current_price > 0
        ? a.current_price / a.current_price_native
        : 1;
    setFxRate(cur === "EUR" ? 1 : rate);
    setForm({
      name: a.name,
      ticker: a.ticker ?? "",
      isin: a.isin ?? "",
      quantity: a.quantity ? String(a.quantity) : "",
      purchase_price: String(a.purchase_price_native ?? a.average_price ?? "") || "",
      purchase_date: today(),
      current_price: String(a.current_price_native ?? a.current_price ?? "") || "",
      invested_amount: a.invested_amount ? String(a.invested_amount) : "",
      current_value: a.current_value ? String(a.current_value) : "",
      metal_type: a.metal_type ?? "Ouro",
      p2p_group: a.p2p_group ?? "A",
      annual_yield: a.annual_yield != null ? String(a.annual_yield) : "",
      currency: cur,
      frequency: a.dividend_frequency ?? "",
    });
    setDialogOpen(true);
  };

  /** Vai buscar ao Yahoo Finance toda a informação do ticker. */
  const lookup = async () => {
    const ticker = form.ticker.trim();
    if (!ticker) {
      toast.error("Escreve primeiro o ticker.");
      return;
    }
    setLooking(true);
    const id = toast.loading(`A procurar ${ticker} no Yahoo Finance...`);
    try {
      const info = (await lookupFn({ data: { ticker } })) as {
        name: string;
        currency: string;
        price: number;
        rate: number | null;
        annualYield: number | null;
        frequency: string | null;
        dividendsPerShareTTM: number;
      };
      setFxRate(info.rate ?? 1);
      setForm((f) => ({
        ...f,
        name: f.name.trim() || info.name,
        currency: info.currency,
        current_price: String(info.price),
        purchase_price: f.purchase_price || String(info.price),
        annual_yield: info.annualYield != null ? info.annualYield.toFixed(2) : f.annual_yield,
        frequency: info.frequency ?? f.frequency,
      }));
      toast.success(
        info.annualYield != null
          ? `${info.name}: ${info.price} ${info.currency} · yield ${formatNumber(info.annualYield, 2)} %`
          : `${info.name}: ${info.price} ${info.currency}`,
        { id },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não encontrei este ticker.", { id });
    } finally {
      setLooking(false);
    }
  };

  const rateFor = async (currency: string): Promise<number> => {
    if (currency === "EUR") return 1;
    if (fxRate && fxRate !== 1) return fxRate;
    const info = (await lookupFn({ data: { ticker: `${currency}EUR=X` } })) as { price: number };
    return info.price;
  };

  const save = async () => {
    setTouched({
      name: true,
      isin: true,
      quantity: true,
      purchase_price: true,
      purchase_date: true,
      current_price: true,
      invested_amount: true,
      current_value: true,
      annual_yield: true,
    });
    if (Object.keys(formErrors).length > 0) return;
    const isin = form.isin.trim().toUpperCase();
    setSaving(true);
    try {
      const quantity = num(form.quantity);
      const rate = isQuantityAsset(assetClass) ? await rateFor(form.currency) : 1;
      const purchaseNative = num(form.purchase_price);
      const currentNative = num(form.current_price);
      const purchaseEur = purchaseNative * rate;
      const currentEur = currentNative * rate;
      const invested = isQuantityAsset(assetClass)
        ? quantity * purchaseEur
        : num(form.invested_amount);
      const current = isQuantityAsset(assetClass) ? quantity * currentEur : num(form.current_value);
      const payload = {
        class: assetClass,
        name: form.name.trim(),
        ticker: form.ticker.trim() || null,
        isin: isin || null,
        quantity,
        average_price: purchaseEur,
        current_price: currentEur,
        invested_amount: invested,
        current_value: current,
        currency: "EUR",
        native_currency: isQuantityAsset(assetClass) ? form.currency : "EUR",
        purchase_price_native: isQuantityAsset(assetClass) ? purchaseNative : null,
        current_price_native: isQuantityAsset(assetClass) ? currentNative : null,
        dividend_frequency: form.frequency.trim() || null,
        metal_type: assetClass === "metal" ? form.metal_type : null,
        p2p_group: assetClass === "p2p" ? form.p2p_group : null,
        annual_yield: form.annual_yield ? num(form.annual_yield) : null,
      };
      let createdId: string | undefined;
      if (editing) {
        await updateFn({ data: { id: editing.id, patch: payload } });
        toast.success("Ativo atualizado.");
      } else if (isQuantityAsset(assetClass) && quantity > 0) {
        // Ativos com quantidade nascem sempre com uma compra no livro FIFO
        // (transactions), nunca com os campos agregados preenchidos
        // diretamente — de outro modo não há data de compra registada e
        // uma venda futura falha por não encontrar lotes abertos.
        const created = (await createFn({
          data: { ...payload, quantity: 0, average_price: 0, invested_amount: 0, current_value: 0 },
        })) as { id: string };
        await buyFn({
          data: {
            assetId: created.id,
            quantity,
            price_native: purchaseNative,
            fee_native: 0,
            traded_at: form.purchase_date,
            notes: null,
          },
        });
        createdId = created.id;
        toast.success("Ativo adicionado.");
      } else {
        const created = (await createFn({ data: payload })) as { id: string };
        createdId = created.id;
        toast.success("Ativo adicionado.");
      }
      if (!editing && paysDividends(assetClass) && payload.ticker && createdId) {
        try {
          const res = (await syncDivFn({ data: { assetId: createdId } })) as {
            inserted: number;
          };
          if (res.inserted > 0)
            toast.success(`${res.inserted} dividendos sincronizados desde a compra.`);
        } catch {
          /* sincronização é best-effort */
        }
      }
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-snapshots"] });
      await queryClient.invalidateQueries({ queryKey: ["dividends"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao guardar.");
    } finally {
      setSaving(false);
    }
  };

  const importDividends = async (a: Asset) => {
    setImportingId(a.id);
    const id = toast.loading(`A sincronizar dividendos de ${a.name}...`);
    try {
      const res = (await syncDivFn({ data: { assetId: a.id } })) as {
        status: string;
        reason?: string;
        inserted: number;
        updated: number;
      };
      await queryClient.invalidateQueries({ queryKey: ["dividends"] });
      if (res.status !== "ok") {
        toast.warning(res.reason ?? "Dados de dividendos indisponíveis.", { id });
      } else {
        toast.success(
          res.inserted > 0
            ? `${res.inserted} dividendos novos (${res.updated} atualizados).`
            : `Sem dividendos novos (${res.updated} atualizados).`,
          { id },
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar dividendos.", { id });
    } finally {
      setImportingId(null);
    }
  };

  const remove = async (a: Asset) => {
    const ok = await confirm({
      title: `Eliminar "${a.name}"?`,
      description:
        "A posição e todos os movimentos e dividendos associados deixam de aparecer na carteira. Esta ação não pode ser anulada.",
      confirmLabel: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFn({ data: { id: a.id } });
      toast.success("Ativo eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-snapshots"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao eliminar.");
    }
  };

  const refreshPrices = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const toastId = toast.loading("A obter preços do Yahoo Finance...");
    try {
      const res = (await refreshFn({ data: { class: assetClass } })) as {
        updated: number;
        failed: string[];
        total: number;
      };
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-snapshots"] });
      if (res.updated === 0 && res.total === 0) {
        toast.info("Não há ativos com ticker nesta página.", { id: toastId });
      } else if (res.failed.length > 0) {
        toast.warning(`${res.updated} preços atualizados. Sem cotação: ${res.failed.join(", ")}`, {
          id: toastId,
        });
      } else {
        toast.success(`${res.updated} preços atualizados.`, { id: toastId });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar preços.", { id: toastId });
    } finally {
      setRefreshing(false);
    }
  };

  const set =
    (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setTouched((t) => ({ ...t, [key]: true }));
    };

  const showYield = assetClass === "acao_dividendo" || assetClass === "reit";
  const quantityLabel = assetClass === "metal" ? "Gramas" : assetClass === "p2p" ? "Grupo" : "Qtd.";
  const quantityText = (a: Asset) =>
    assetClass === "p2p" ? (a.p2p_group ?? "—") : a.quantity ? formatQuantity(a.quantity) : "—";

  /** Valor em EUR com a moeda original por baixo (ativos em moeda estrangeira). */
  const withNative = (eur: number, native: number | null | undefined, cur: string) => (
    <>
      {formatEUR(eur, hidden)}
      {cur !== "EUR" && native != null && (
        <span className="block whitespace-nowrap text-xs text-muted-foreground">
          {formatMoney(native, cur, hidden)}
        </span>
      )}
    </>
  );
  const rateOf = (a: Asset) =>
    a.current_price_native && a.current_price_native > 0 && a.current_price > 0
      ? a.current_price / a.current_price_native
      : 1;

  const assetName = (a: Asset) => (
    <div className="min-w-0 max-w-[26rem]">
      <p className="font-medium">{a.name}</p>
      {a.ticker && <p className="text-xs text-muted-foreground">{a.ticker}</p>}
    </div>
  );

  const rowActions = (a: Asset) => (
    <div className="flex justify-end gap-1">
      {isQuantityAsset(assetClass) && (
        <IconButton label={`Comprar ou vender ${a.name}`} onClick={() => setPositionAsset(a)}>
          <ArrowLeftRight aria-hidden className="h-4 w-4" />
        </IconButton>
      )}
      {paysDividends(assetClass) && a.ticker && (
        <IconButton
          label={`Importar dividendos de ${a.name}`}
          onClick={() => importDividends(a)}
          disabled={importingId === a.id}
        >
          <Download aria-hidden className="h-4 w-4" />
        </IconButton>
      )}
      <IconButton label={`Editar ${a.name}`} onClick={() => openEdit(a)}>
        <Pencil aria-hidden className="h-4 w-4" />
      </IconButton>
      <IconButton
        label={`Eliminar ${a.name}`}
        className="hover:bg-destructive/15 hover:text-destructive"
        onClick={() => remove(a)}
      >
        <Trash2 aria-hidden className="h-4 w-4" />
      </IconButton>
    </div>
  );

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
            <Delta value={p.abs}>{formatEUR(p.abs, hidden)}</Delta>
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
              {formatPercent(p.pct, hidden)}
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
                {a.annual_yield == null ? "—" : formatPercent(a.annual_yield, hidden)}
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

  const Pair = ({ label, value }: { label: string; value: React.ReactNode }) => (
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
          <div className="min-w-0">
            <p className="font-medium leading-snug">{a.name}</p>
            {a.ticker && <p className="text-xs text-muted-foreground">{a.ticker}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="num font-semibold">{formatEUR(assetCurrentValue(a), hidden)}</p>
            <Delta value={p.abs} className="justify-end text-xs">
              {formatEUR(p.abs, hidden)} · {formatPercent(p.pct, hidden)}
            </Delta>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Pair label={quantityLabel} value={quantityText(a)} />
          <Pair label="Investido" value={formatEUR(assetInvested(a), hidden)} />
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
              value={a.annual_yield == null ? "—" : formatPercent(a.annual_yield, hidden)}
            />
          )}
        </dl>
        <div className="border-t border-border/60 pt-2">{rowActions(a)}</div>
      </div>
    );
  };

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
        <Delta value={assetRealizedPL(a)}>{formatEUR(assetRealizedPL(a), hidden)}</Delta>
      ),
    },
    {
      id: "fees",
      header: "Comissões",
      align: "right",
      sortValue: (a) => a.total_fees ?? 0,
      cell: (a) => (
        <span className="text-muted-foreground">{formatEUR(a.total_fees ?? 0, hidden)}</span>
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
      cell: (a) => (
        <div className="flex justify-end gap-1">
          <IconButton label={`Ver histórico de ${a.name}`} onClick={() => setPositionAsset(a)}>
            <ArrowLeftRight aria-hidden className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={`Eliminar ${a.name}`}
            className="hover:bg-destructive/15 hover:text-destructive"
            onClick={() => remove(a)}
          >
            <Trash2 aria-hidden className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  const closedCard = (a: Asset) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{a.name}</p>
          {a.ticker && <p className="text-xs text-muted-foreground">{a.ticker}</p>}
        </div>
        <Delta value={assetRealizedPL(a)} className="shrink-0">
          {formatEUR(assetRealizedPL(a), hidden)}
        </Delta>
      </div>
      <p className="text-xs text-muted-foreground">
        Fecho {formatDatePt(a.closed_at)} · comissões {formatEUR(a.total_fees ?? 0, hidden)}
      </p>
      <div className="border-t border-border/60 pt-2">
        <div className="flex justify-end gap-1">
          <IconButton label={`Ver histórico de ${a.name}`} onClick={() => setPositionAsset(a)}>
            <ArrowLeftRight aria-hidden className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={`Eliminar ${a.name}`}
            className="hover:bg-destructive/15 hover:text-destructive"
            onClick={() => remove(a)}
          >
            <Trash2 aria-hidden className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <Button variant="outline" onClick={refreshPrices} loading={refreshing}>
              {!refreshing && <RefreshCw aria-hidden className="h-4 w-4" />}
              Atualizar preços
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </>
        }
      />

      {assetClass !== "etf" && lastPriceUpdate && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Cotações atualizadas em {new Date(lastPriceUpdate).toLocaleString("pt-PT")} · fonte de
          mercado (Yahoo Finance), sem estimativas.
        </p>
      )}

      <div
        className={cn(
          "grid grid-cols-2 gap-3 md:gap-4",
          assetClass === "reit" || assetClass === "acao_dividendo"
            ? "xl:grid-cols-6"
            : "xl:grid-cols-5",
        )}
      >
        <MetricCard label="Valor atual" value={formatEUR(totals.current, hidden)} />
        <MetricCard label="Total investido" value={formatEUR(totals.invested, hidden)} />
        <MetricCard
          label="P/L não realizado"
          value={formatEUR(pl, hidden)}
          sub={formatPercent(plPct, hidden)}
          tone={pl > 0 ? "positive" : pl < 0 ? "negative" : "default"}
        />
        <MetricCard
          label="P/L realizado"
          value={formatEUR(realizedTotal, hidden)}
          sub={
            closedAssets.length > 0
              ? `${closedAssets.length} posições fechadas`
              : "Vendas concretizadas"
          }
          tone={realizedTotal > 0 ? "positive" : realizedTotal < 0 ? "negative" : "default"}
        />
        <MetricCard label="Posições abertas" value={String(assets.length)} />
        {(assetClass === "reit" || assetClass === "acao_dividendo") && (
          <MetricCard
            label="Yield médio"
            value={averageYield == null ? "—" : formatPercent(averageYield, hidden)}
            sub={yields.length > 0 ? `${yields.length} ativos com dados` : "Dados não disponíveis"}
          />
        )}
      </div>

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div
          aria-busy="true"
          aria-label="A carregar posições"
          className="space-y-2 rounded-xl border border-border bg-card p-4"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <EmptyState
          title={emptyLabel ?? "Ainda não tens posições aqui"}
          description="Adiciona o primeiro ativo para começar a acompanhar esta classe."
          action={
            <Button onClick={openCreate}>
              <Plus aria-hidden className="h-4 w-4" />
              Adicionar primeiro ativo
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={assets}
          columns={openColumns}
          rowKey={(a) => a.id}
          caption={`Posições abertas — ${title}`}
          storageKey={`assets:${assetClass}`}
          defaultSort={{ id: "name", dir: "asc" }}
          searchText={(a) => `${a.name} ${a.ticker ?? ""} ${a.isin ?? ""}`}
          searchPlaceholder="Pesquisar por nome, ticker ou ISIN…"
          renderCard={openCard}
        />
      )}

      {closedAssets.length > 0 && (
        <section aria-labelledby="posicoes-fechadas" className="space-y-3">
          <div>
            <h2 id="posicoes-fechadas" className="text-lg font-semibold">
              Posições fechadas
            </h2>
            <p className="text-sm text-muted-foreground">
              Ativos totalmente vendidos — o histórico permanece disponível.
            </p>
          </div>
          <DataTable
            rows={closedAssets}
            columns={closedColumns}
            rowKey={(a) => a.id}
            caption={`Posições fechadas — ${title}`}
            defaultSort={{ id: "closed", dir: "desc" }}
            renderCard={closedCard}
          />
        </section>
      )}

      <AssetPositionModal asset={positionAsset} onClose={() => setPositionAsset(null)} />

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Editar ativo" : "Adicionar ativo"}
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          {isSecurity(assetClass) && (
            <>
              <Field label="Ticker">
                <div className="flex gap-2">
                  <TextInput
                    value={form.ticker}
                    onChange={set("ticker")}
                    placeholder="Ex.: O, VICI, VWCE.DE"
                    autoComplete="off"
                  />
                  {assetClass !== "etf" && (
                    <Button type="button" variant="outline" onClick={lookup} loading={looking}>
                      {!looking && <Search aria-hidden className="h-4 w-4" />}
                      {looking ? "A procurar…" : "Procurar"}
                    </Button>
                  )}
                </div>
              </Field>

              {assetClass === "etf" && (
                <Field
                  label="ISIN (opcional)"
                  error={err("isin")}
                  hint="Usado para obter a composição e exposição exclusivamente no JustETF."
                >
                  <TextInput
                    value={form.isin}
                    onChange={set("isin")}
                    onBlur={touch("isin")}
                    placeholder="Ex.: IE00BK5BQT80"
                    maxLength={12}
                    autoComplete="off"
                    className="uppercase"
                  />
                </Field>
              )}
            </>
          )}

          <Field label="Nome" required error={err("name")}>
            <TextInput
              value={form.name}
              onChange={set("name")}
              onBlur={touch("name")}
              autoComplete="off"
              placeholder={
                assetClass === "p2p"
                  ? "Ex.: Mintos"
                  : assetClass === "metal"
                    ? "Ex.: Barra de ouro 50g"
                    : "Ex.: Realty Income"
              }
            />
          </Field>

          {assetClass === "metal" && (
            <Field label="Metal">
              <SelectInput value={form.metal_type} onChange={set("metal_type")}>
                <option value="Ouro">Ouro</option>
                <option value="Prata">Prata</option>
              </SelectInput>
            </Field>
          )}

          {assetClass === "p2p" && (
            <Field label="Grupo">
              <SelectInput value={form.p2p_group} onChange={set("p2p_group")}>
                <option value="A">Grupo A — até 12,4 %</option>
                <option value="B">Grupo B — até 25 %</option>
              </SelectInput>
            </Field>
          )}

          {isQuantityAsset(assetClass) ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={assetClass === "metal" ? "Peso (gramas)" : "Quantidade"}
                  error={err("quantity")}
                >
                  <TextInput
                    inputMode="decimal"
                    autoComplete="off"
                    value={form.quantity}
                    onChange={set("quantity")}
                    onBlur={touch("quantity")}
                    placeholder="0"
                  />
                </Field>
                <Field label="Moeda">
                  <SelectInput value={form.currency} onChange={set("currency")}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              </div>
              {!editing && (
                <Field label="Data da compra" error={err("purchase_date")}>
                  <TextInput
                    type="date"
                    value={form.purchase_date}
                    onChange={set("purchase_date")}
                    onBlur={touch("purchase_date")}
                    max={today()}
                  />
                </Field>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={`Preço de compra por ${assetClass === "metal" ? "grama" : "ação"} (${form.currency})`}
                  error={err("purchase_price")}
                >
                  <TextInput
                    inputMode="decimal"
                    autoComplete="off"
                    value={form.purchase_price}
                    onChange={set("purchase_price")}
                    onBlur={touch("purchase_price")}
                    placeholder="0,00"
                  />
                </Field>
                <Field label={`Preço atual (${form.currency})`} error={err("current_price")}>
                  <TextInput
                    inputMode="decimal"
                    autoComplete="off"
                    value={form.current_price}
                    onChange={set("current_price")}
                    onBlur={touch("current_price")}
                    placeholder="0,00"
                  />
                </Field>
              </div>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Total investido (€)" error={err("invested_amount")}>
                <TextInput
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.invested_amount}
                  onChange={set("invested_amount")}
                  onBlur={touch("invested_amount")}
                  placeholder="0,00"
                />
              </Field>
              <Field label="Valor atual (€)" error={err("current_value")}>
                <TextInput
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.current_value}
                  onChange={set("current_value")}
                  onBlur={touch("current_value")}
                  placeholder="0,00"
                />
              </Field>
            </div>
          )}

          {(assetClass === "p2p" || paysDividends(assetClass)) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Yield anual (%)" error={err("annual_yield")}>
                <TextInput
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.annual_yield}
                  onChange={set("annual_yield")}
                  onBlur={touch("annual_yield")}
                  placeholder="Ex.: 5,2"
                />
              </Field>
              {assetClass !== "p2p" && (
                <Field label="Frequência">
                  <TextInput
                    value={form.frequency}
                    onChange={set("frequency")}
                    placeholder="Ex.: Mensal"
                  />
                </Field>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Guardar alterações" : "Adicionar"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
