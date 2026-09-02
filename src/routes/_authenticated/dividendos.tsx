import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import { listAssets, listDividends, createDividend, deleteDividend } from "@/lib/portfolio.functions";
import { syncAllDividends, recalculateDividends } from "@/lib/dividends.functions";
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
import { formatEUR, formatMoney, formatDatePt, formatPercent } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { PageHeader, MetricCard, EmptyState, Button, Modal, Field, TextInput } from "@/components/ui-bits";

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
      { property: "og:description", content: "Rendimentos passivos: recebidos, previstos e histórico." },
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
  const fetchAssets = useServerFn(listAssets);
  const fetchDividends = useServerFn(listDividends);
  const createFn = useServerFn(createDividend);
  const deleteFn = useServerFn(deleteDividend);
  const syncFn = useServerFn(syncAllDividends);
  const recalcFn = useServerFn(recalculateDividends);

  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [exDate, setExDate] = useState("");
  const [tax, setTax] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const { data: assetsRaw } = useQuery({ queryKey: ["assets"], queryFn: () => fetchAssets() });
  const { data: dividendsRaw, isLoading } = useQuery({
    queryKey: ["dividends"],
    queryFn: () => fetchDividends(),
  });

  const assets = (assetsRaw ?? []) as Asset[];
  const dividends = (dividendsRaw ?? []) as Dividend[];

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

  const save = async () => {
    const value = parseFloat(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Indica um valor válido.");
      return;
    }
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) {
      toast.error("Escolhe o ativo que pagou o dividendo.");
      return;
    }
    const taxValue = parseFloat(tax.replace(",", ".")) || 0;
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
    if (!window.confirm("Eliminar este registo de dividendo?")) return;
    try {
      await deleteFn({ data: { id: d.id } });
      await queryClient.invalidateQueries({ queryKey: ["dividends"] });
      toast.success("Registo eliminado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao eliminar.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dividendos"
        subtitle="Dividendos efetivamente recebidos, calculados sobre a posição elegível em cada data ex-dividendo."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={sync} disabled={syncing}>
              <RefreshCw className={syncing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Sincronizar
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              Registar dividendo
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <MetricCard label={`Recebidos em ${year}`} value={formatEUR(stats.receivedYear, hidden)} />
        <MetricCard label="Total recebido" value={formatEUR(stats.received, hidden)} sub="Desde o início" />
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
            <span key={cur} className="rounded-full border border-border px-3 py-1">
              {cur}: {formatMoney(total, cur, hidden)}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Recebidos por mês ({year})</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip
                formatter={(v: number) => formatEUR(v, hidden)}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                }}
              />
              <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Dividendos por ativo</h2>
          {stats.byAsset.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda sem dividendos recebidos.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stats.byAsset.map((a) => (
                <li key={a.assetId ?? a.assetName} className="flex justify-between">
                  <span>
                    {a.assetName}{" "}
                    <span className="text-xs text-muted-foreground">({a.count} pagamentos)</span>
                  </span>
                  <span className="font-medium text-success">{formatEUR(a.total, hidden)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Próximos pagamentos</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem pagamentos anunciados.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {upcoming.slice(0, 8).map((d) => (
                <li key={d.id} className="flex justify-between">
                  <span>
                    {d.asset_name}{" "}
                    <span className="text-xs text-muted-foreground">
                      {formatDatePt(d.payment_date ?? d.paid_at)}
                    </span>
                  </span>
                  <span className="font-medium">{formatEUR(grossOf(d as never), hidden)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          A carregar…
        </div>
      ) : dividends.length === 0 ? (
        <EmptyState
          title="Ainda sem dividendos registados"
          description="Sincroniza os dividendos dos teus ativos ou regista manualmente o primeiro pagamento."
          action={
            <Button onClick={sync} disabled={syncing}>
              <RefreshCw className="h-4 w-4" />
              Sincronizar dividendos
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Pagamento</th>
                <th className="px-4 py-3 font-medium">Ex-date</th>
                <th className="px-4 py-3 font-medium">Ativo</th>
                <th className="px-4 py-3 text-right font-medium">Qtd. elegível</th>
                <th className="px-4 py-3 text-right font-medium">Por ação</th>
                <th className="px-4 py-3 text-right font-medium">Bruto</th>
                <th className="px-4 py-3 text-right font-medium">Líquido</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {dividends.map((d) => {
                const received = isReceived(d as never);
                const cur = (d.currency ?? "EUR").toUpperCase();
                return (
                  <tr key={d.id} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDatePt(d.payment_date ?? d.paid_at)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDatePt(d.ex_date)}</td>
                    <td className="px-4 py-3 font-medium">{d.asset_name}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {d.eligible_quantity == null ? "—" : d.eligible_quantity}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {d.per_share_native == null
                        ? "—"
                        : formatMoney(d.per_share_native, cur, hidden)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-success">
                      <div>{formatEUR(d.gross_amount ?? d.amount, hidden)}</div>
                      {cur !== "EUR" && d.amount_native != null && (
                        <div className="text-xs font-normal text-muted-foreground">
                          {formatMoney(d.amount_native, cur, hidden)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatEUR(d.net_amount ?? d.gross_amount ?? d.amount, hidden)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          received
                            ? "rounded-full bg-success/15 px-2 py-1 text-xs text-success"
                            : "rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
                        }
                      >
                        {received ? "Recebido" : d.status === "unknown" ? "Por confirmar" : "Previsto"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={() => remove(d)}
                          className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                          aria-label="Eliminar registo"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Registar dividendo">
        <div className="space-y-4">
          <Field label="Ativo">
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            >
              <option value="">Escolher ativo…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor bruto (€)">
              <TextInput
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </Field>
            <Field label="Imposto retido (€)">
              <TextInput
                inputMode="decimal"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                placeholder="0,00"
              />
            </Field>
            <Field label="Data ex-dividendo">
              <TextInput type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} />
            </Field>
            <Field label="Data de pagamento">
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "A guardar…" : "Registar"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
