import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, RefreshCw, ShieldCheck } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { toast } from "sonner";
import {
  listAssets,
  listDividends,
  createDividend,
  deleteDividend,
} from "@/lib/portfolio.functions";
import { syncAllDividends, recalculateDividends, auditDividends } from "@/lib/dividends.functions";
import { type Asset, type Dividend, assetInvested } from "@/lib/portfolio-types";
import {
  isReceived,
  grossOf,
  totalReceived,
  totalScheduled,
  receivedInYear,
  receivedByMonth,
  receivedByAsset,
  receivedByCurrency,
  receivedLast12Months,
  yieldOnCost,
} from "@/lib/dividends";
import {
  formatEUR,
  formatMoney,
  formatCompact,
  formatDatePt,
  formatPercent,
  formatQuantity,
  parseNumberOr,
  parseNumberPt,
} from "@/lib/format";
import { todayLisbon } from "@/lib/dates";
import { usePrivateMode } from "@/components/private-mode";
import {
  PageHeader,
  MetricCard,
  EmptyState,
  ErrorState,
  Badge,
  Button,
  Card,
  IconButton,
  Modal,
  Field,
  SelectInput,
  TextInput,
  useConfirm,
} from "@/components/ui-bits";
import { DataTable, type Column } from "@/components/data-table";
import { AXIS_LINE, AXIS_TICK, ChartFrame, ChartTooltip, GRID_PROPS } from "@/components/chart-kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/dividendos")({
  head: () => ({
    meta: [
      { title: "Dividendos — Portefólio Tracker" },
      {
        name: "description",
        content:
          "Dividendos efetivamente recebidos, previstos, histórico mensal e yield sobre o custo do teu portefólio.",
      },
      { property: "og:title", content: "Dividendos — Portefólio Tracker" },
      {
        property: "og:description",
        content: "Rendimentos passivos: recebidos, previstos e histórico.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DividendosPage,
});

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function DividendosPage() {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const fetchAssets = useServerFn(listAssets);
  const fetchDividends = useServerFn(listDividends);
  const createFn = useServerFn(createDividend);
  const deleteFn = useServerFn(deleteDividend);
  const syncFn = useServerFn(syncAllDividends);
  const recalcFn = useServerFn(recalculateDividends);
  const auditFn = useServerFn(auditDividends);

  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => todayLisbon());
  const [exDate, setExDate] = useState("");
  const [tax, setTax] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [filter, setFilter] = useState<"all" | "received" | "pending">("all");
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const { data: assetsRaw } = useQuery({ queryKey: ["assets"], queryFn: () => fetchAssets() });
  const {
    data: dividendsRaw,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["dividends"],
    queryFn: () => fetchDividends(),
  });

  const assets = useMemo(() => (assetsRaw ?? []) as Asset[], [assetsRaw]);
  const dividends = useMemo(() => (dividendsRaw ?? []) as Dividend[], [dividendsRaw]);

  const year = new Date().getFullYear();
  const stats = useMemo(() => {
    const rows = dividends.map((d) => ({
      asset_id: d.asset_id,
      asset_name: d.asset_name,
      amount: d.amount,
      gross_amount: d.gross_amount ?? d.amount,
      net_amount: d.net_amount ?? null,
      amount_native: d.amount_native ?? null,
      currency: d.currency ?? "EUR",
      payment_date: d.payment_date ?? d.paid_at,
      paid_at: d.paid_at,
      status: d.status ?? "received",
    }));
    const byMonth = receivedByMonth(rows);
    const monthly = MONTHS.map((label, i) => ({
      month: label,
      total: byMonth[`${year}-${String(i + 1).padStart(2, "0")}`] ?? 0,
    }));
    const investedTotal = assets.reduce((s, a) => s + assetInvested(a), 0);
    return {
      received: totalReceived(rows),
      receivedYear: receivedInYear(rows, year),
      scheduled: totalScheduled(rows),
      byAsset: receivedByAsset(rows),
      byCurrency: receivedByCurrency(rows),
      last12m: receivedLast12Months(rows),
      yoc: yieldOnCost(receivedLast12Months(rows), investedTotal),
      monthly,
    };
  }, [dividends, assets, year]);

  const upcoming = dividends
    .filter((d) => !isReceived(d as never))
    .sort((a, b) => (a.payment_date ?? a.paid_at).localeCompare(b.payment_date ?? b.paid_at));

  const sync = async () => {
    setSyncing(true);
    const id = toast.loading("A sincronizar dividendos…");
    try {
      const res = (await syncFn({ data: { class: null } })) as {
        inserted: number;
        updated: number;
        unavailable: string[];
      };
      await recalcFn();
      await queryClient.invalidateQueries({ queryKey: ["dividends"] });
      toast.success(
        `${res.inserted} novos, ${res.updated} atualizados${
          res.unavailable.length > 0 ? ` · sem dados: ${res.unavailable.join(", ")}` : ""
        }`,
        { id },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na sincronização.", { id });
    } finally {
      setSyncing(false);
    }
  };

  const runAudit = async () => {
    setAuditing(true);
    const id = toast.loading("A auditar dividendos…");
    try {
      const res = (await auditFn()) as {
        reviewed: number;
        findings: Array<{ assetName: string; issues: string[] }>;
        duplicates: Array<{ assetName: string; count: number }>;
      };
      if (res.findings.length === 0 && res.duplicates.length === 0) {
        toast.success(`${res.reviewed} registos verificados, sem problemas.`, { id });
      } else {
        toast.warning(
          `${res.findings.length} registos com problemas${
            res.duplicates.length > 0 ? ` · ${res.duplicates.length} duplicados` : ""
          }. Usa Sincronizar para recalcular.`,
          { id },
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na auditoria.", { id });
    } finally {
      setAuditing(false);
    }
  };

  /** Erros por campo, calculados a cada alteração (mostrados depois de tocar no campo). */
  const errors = useMemo(() => {
    const e: Partial<Record<"asset" | "amount" | "tax" | "date" | "exDate", string>> = {};
    if (!assetId) e.asset = "Escolhe o ativo que pagou o dividendo.";
    const value = parseNumberPt(amount);
    if (!(value > 0)) e.amount = "Indica o valor bruto (maior que 0).";
    if (tax.trim() !== "" && !(parseNumberPt(tax) >= 0)) e.tax = "O imposto não pode ser negativo.";
    if (tax.trim() !== "" && value > 0 && parseNumberPt(tax) > value)
      e.tax = "O imposto não pode ser maior que o valor bruto.";
    if (!date) e.date = "Indica a data de pagamento.";
    if (exDate && date && exDate > date)
      e.exDate = "A data ex-dividendo é anterior ou igual à de pagamento.";
    return e;
  }, [assetId, amount, tax, date, exDate]);
  const err = (k: keyof typeof errors) => (touched[k] ? errors[k] : undefined);
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  const openForm = () => {
    setTouched({});
    setOpen(true);
  };

  const save = async () => {
    setTouched({ asset: true, amount: true, tax: true, date: true, exDate: true });
    if (Object.keys(errors).length > 0) return;
    const value = parseNumberPt(amount);
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;
    const taxValue = parseNumberOr(tax, 0);
    setSaving(true);
    try {
      await createFn({
        data: {
          asset_id: asset.id,
          asset_name: asset.name,
          amount: value,
          paid_at: date,
          ex_date: exDate || null,
          currency: "EUR",
          amount_native: value,
          fx_rate: 1,
          tax_amount: taxValue,
        },
      });
      toast.success("Dividendo registado.");
      setOpen(false);
      setAmount("");
      setTax("");
      await queryClient.invalidateQueries({ queryKey: ["dividends"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao registar.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: Dividend) => {
    const ok = await confirm({
      title: "Eliminar este dividendo?",
      description: `${d.asset_name ?? "Dividendo"} · ${formatDatePt(d.payment_date ?? d.paid_at)}. Esta ação não pode ser anulada.`,
      confirmLabel: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFn({ data: { id: d.id } });
      await queryClient.invalidateQueries({ queryKey: ["dividends"] });
      toast.success("Registo eliminado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao eliminar.");
    }
  };

  const filteredDividends = useMemo(
    () =>
      dividends.filter((d) => {
        if (filter === "all") return true;
        const r = isReceived(d as never);
        return filter === "received" ? r : !r;
      }),
    [dividends, filter],
  );

  const statusBadge = (d: Dividend) => {
    const received = isReceived(d as never);
    return received ? (
      <Badge tone="gain">Recebido</Badge>
    ) : (
      <Badge>{d.status === "unknown" ? "Por confirmar" : "Previsto"}</Badge>
    );
  };

  const removeButton = (d: Dividend) => (
    <IconButton
      label={`Eliminar dividendo de ${d.asset_name ?? "ativo"} (${formatDatePt(d.payment_date ?? d.paid_at)})`}
      className="hover:bg-destructive/15 hover:text-destructive"
      onClick={() => remove(d)}
    >
      <Trash2 aria-hidden className="h-4 w-4" />
    </IconButton>
  );

  const columns: Column<Dividend>[] = [
    {
      id: "payment",
      header: "Pagamento",
      required: true,
      sortValue: (d) => d.payment_date ?? d.paid_at,
      cell: (d) => (
        <span className="text-muted-foreground">
          {formatDatePt(d.payment_date ?? d.paid_at)}
          {d.payment_date_estimated && (
            <span className="block text-xs" title="Data estimada a partir da ex-dividendo">
              estimada
            </span>
          )}
        </span>
      ),
    },
    {
      id: "ex",
      header: "Ex-date",
      sortValue: (d) => d.ex_date ?? "",
      cell: (d) => <span className="text-muted-foreground">{formatDatePt(d.ex_date)}</span>,
    },
    {
      id: "asset",
      header: "Ativo",
      required: true,
      sortValue: (d) => (d.asset_name ?? "").toLowerCase(),
      cell: (d) => <span className="font-medium">{d.asset_name}</span>,
    },
    {
      id: "qty",
      header: "Qtd. elegível",
      align: "right",
      sortValue: (d) => d.eligible_quantity ?? null,
      cell: (d) => (
        <span className="text-muted-foreground">
          {d.eligible_quantity == null ? "—" : formatQuantity(d.eligible_quantity)}
        </span>
      ),
    },
    {
      id: "perShare",
      header: "Por ação",
      align: "right",
      defaultHidden: true,
      sortValue: (d) => d.per_share_native ?? null,
      cell: (d) => (
        <span className="text-muted-foreground">
          {d.per_share_native == null
            ? "—"
            : formatMoney(d.per_share_native, (d.currency ?? "EUR").toUpperCase(), hidden)}
        </span>
      ),
    },
    {
      id: "gross",
      header: "Bruto",
      align: "right",
      sortValue: (d) => d.gross_amount ?? d.amount,
      cell: (d) => {
        const cur = (d.currency ?? "EUR").toUpperCase();
        return (
          <span className="font-medium text-success">
            {formatEUR(d.gross_amount ?? d.amount, hidden)}
            {cur !== "EUR" && d.amount_native != null && (
              <span className="block text-xs font-normal text-muted-foreground">
                {formatMoney(d.amount_native, cur, hidden)}
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: "net",
      header: "Líquido",
      align: "right",
      sortValue: (d) => d.net_amount ?? d.gross_amount ?? d.amount,
      cell: (d) => formatEUR(d.net_amount ?? d.gross_amount ?? d.amount, hidden),
    },
    {
      id: "status",
      header: "Estado",
      sortValue: (d) => (isReceived(d as never) ? 1 : 0),
      cell: statusBadge,
    },
    {
      id: "actions",
      header: <span className="sr-only">Ações</span>,
      required: true,
      cell: (d) => <div className="flex justify-end">{removeButton(d)}</div>,
    },
  ];

  const renderCard = (d: Dividend) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{d.asset_name}</p>
          <p className="text-xs text-muted-foreground">
            {formatDatePt(d.payment_date ?? d.paid_at)}
            {d.payment_date_estimated ? " (estimada)" : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num font-semibold text-success">
            {formatEUR(d.gross_amount ?? d.amount, hidden)}
          </p>
          <p className="num text-xs text-muted-foreground">
            líquido {formatEUR(d.net_amount ?? d.gross_amount ?? d.amount, hidden)}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border/60 pt-2">
        {statusBadge(d)}
        {removeButton(d)}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dividendos"
        subtitle="Dividendos efetivamente recebidos, calculados sobre a posição elegível em cada data ex-dividendo."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={runAudit} loading={auditing}>
              {!auditing && <ShieldCheck aria-hidden className="h-4 w-4" />}
              Auditar
            </Button>
            <Button variant="outline" onClick={sync} loading={syncing}>
              {!syncing && <RefreshCw aria-hidden className="h-4 w-4" />}
              Sincronizar
            </Button>
            <Button onClick={openForm}>
              <Plus aria-hidden className="h-4 w-4" />
              Registar dividendo
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <MetricCard label={`Recebidos em ${year}`} value={formatEUR(stats.receivedYear, hidden)} />
        <MetricCard
          label="Total recebido"
          value={formatEUR(stats.received, hidden)}
          sub="Desde o início"
        />
        <MetricCard
          label="Previstos"
          value={formatEUR(stats.scheduled, hidden)}
          sub="Anunciados, ainda não pagos"
        />
        <MetricCard
          label="Yield sobre o custo"
          value={stats.yoc == null ? "—" : formatPercent(stats.yoc, hidden)}
          sub="Últimos 12 meses / custo"
        />
      </div>

      {Object.keys(stats.byCurrency).length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {Object.entries(stats.byCurrency).map(([cur, total]) => (
            <Badge key={cur} className="px-3 py-1 text-xs">
              {cur}: {formatMoney(total, cur, hidden)}
            </Badge>
          ))}
        </div>
      )}

      <Card title={`Recebidos por mês (${year})`}>
        <ChartFrame
          label={`Dividendos recebidos em cada mês de ${year}`}
          loading={isLoading}
          empty={stats.monthly.every((m) => m.total === 0)}
          emptyLabel={`Ainda não há dividendos recebidos em ${year}.`}
        >
          <BarChart data={stats.monthly}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="month" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => (hidden ? "•" : formatCompact(v))}
            />
            <Tooltip
              cursor={{ fill: "var(--color-accent)", opacity: 0.4 }}
              content={<ChartTooltip valueFormatter={(v) => formatEUR(v, hidden)} />}
            />
            <Bar
              dataKey="total"
              name="Recebido"
              fill="var(--color-chart-2)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartFrame>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Dividendos por ativo">
          {stats.byAsset.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda sem dividendos recebidos.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stats.byAsset.map((a) => (
                <li
                  key={a.assetId ?? a.assetName}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {a.assetName}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({a.count} {a.count === 1 ? "pagamento" : "pagamentos"})
                    </span>
                  </span>
                  <span className="num shrink-0 font-medium text-success">
                    {formatEUR(a.total, hidden)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Próximos pagamentos">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem pagamentos anunciados.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {upcoming.slice(0, 8).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate">
                    {d.asset_name}{" "}
                    <span className="text-xs text-muted-foreground">
                      {formatDatePt(d.payment_date ?? d.paid_at)}
                      {d.payment_date_estimated ? " (estimada)" : ""}
                    </span>
                  </span>
                  <span className="num shrink-0 font-medium">
                    {formatEUR(grossOf(d as never), hidden)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div
          aria-busy="true"
          aria-label="A carregar dividendos"
          className="space-y-2 rounded-xl border border-border bg-card p-4"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : dividends.length === 0 ? (
        <EmptyState
          title="Ainda sem dividendos registados"
          description="Sincroniza os dividendos dos teus ativos ou regista manualmente o primeiro pagamento."
          action={
            <Button onClick={sync} loading={syncing}>
              {!syncing && <RefreshCw aria-hidden className="h-4 w-4" />}
              Sincronizar dividendos
            </Button>
          }
        />
      ) : (
        <section aria-labelledby="hist-dividendos" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="hist-dividendos" className="text-base font-semibold">
              Histórico
            </h2>
            <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", `Todos (${dividends.length})`],
                  [
                    "received",
                    `Recebidos (${dividends.filter((d) => isReceived(d as never)).length})`,
                  ],
                  ["pending", `Previstos (${upcoming.length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                  className={
                    filter === key
                      ? "min-h-9 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                      : "min-h-9 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <DataTable
            rows={filteredDividends}
            columns={columns}
            rowKey={(d) => d.id}
            caption="Histórico de dividendos"
            storageKey="dividends"
            defaultSort={{ id: "payment", dir: "desc" }}
            searchText={(d) => `${d.asset_name ?? ""} ${formatDatePt(d.payment_date ?? d.paid_at)}`}
            searchPlaceholder="Pesquisar por ativo ou data…"
            pageSize={25}
            emptyTitle="Sem dividendos neste filtro"
            emptyDescription="Experimenta outro filtro ou limpa a pesquisa."
            renderCard={renderCard}
          />
        </section>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Registar dividendo">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <Field label="Ativo" required error={err("asset")}>
            <SelectInput
              value={assetId}
              onChange={(e) => {
                setAssetId(e.target.value);
                touch("asset");
              }}
              onBlur={() => touch("asset")}
            >
              <option value="">Escolher ativo…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Valor bruto (€)" required error={err("amount")}>
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => touch("amount")}
                placeholder="0,00"
              />
            </Field>
            <Field
              label="Imposto retido (€)"
              error={err("tax")}
              hint="Opcional. Se ficar vazio, não há retenção."
            >
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                onBlur={() => touch("tax")}
                placeholder="0,00"
              />
            </Field>
            <Field label="Data ex-dividendo" error={err("exDate")}>
              <TextInput
                type="date"
                value={exDate}
                onChange={(e) => setExDate(e.target.value)}
                onBlur={() => touch("exDate")}
              />
            </Field>
            <Field label="Data de pagamento" required error={err("date")}>
              <TextInput
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onBlur={() => touch("date")}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Registar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
