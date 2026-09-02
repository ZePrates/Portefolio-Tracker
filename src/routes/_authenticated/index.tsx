import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, RefreshCw } from "lucide-react";
import { PieChart as PieIcon } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { listAssets, listDividends } from "@/lib/portfolio.functions";
import { updateAllPrices } from "@/lib/prices.functions";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  type Asset,
  type AssetClass,
  type Dividend,
  CLASS_LABELS,
  assetCurrentValue,
  assetInvested,
} from "@/lib/portfolio-types";
import { formatEUR, formatPercent } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { PageHeader, MetricCard, EmptyState, Button } from "@/components/ui-bits";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Portefólio Tracker" },
      { name: "description", content: "Visão global do teu portefólio de investimentos: valor total, ganhos, alocação por classe e dividendos." },
      { property: "og:title", content: "Dashboard — Portefólio Tracker" },
      { property: "og:description", content: "Visão global do teu portefólio de investimentos." },
    ],
  }),
  component: DashboardPage,
});

const CLASS_ROUTES: Record<AssetClass, string> = {
  etf: "/etfs",
  reit: "/reits",
  acao_dividendo: "/acoes-dividendos",
  acao_crescimento: "/acoes-crescimento",
  metal: "/metais",
  p2p: "/p2p",
};

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
];

function DashboardPage() {
  const { hidden } = usePrivateMode();
  const fetchAssets = useServerFn(listAssets);
  const fetchDividends = useServerFn(listDividends);
  const refreshFn = useServerFn(updateAllPrices);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refreshPrices = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const toastId = toast.loading("A obter preços do Yahoo Finance...");
    try {
      const res = (await refreshFn({ data: { class: null } })) as {
        updated: number;
        failed: string[];
        total: number;
      };
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      if (res.failed.length > 0) {
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

  const { data: assetsRaw, isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetchAssets(),
  });
  const { data: dividendsRaw } = useQuery({
    queryKey: ["dividends"],
    queryFn: () => fetchDividends(),
  });

  const assets = (assetsRaw ?? []) as Asset[];
  const dividends = (dividendsRaw ?? []) as Dividend[];

  const invested = assets.reduce((s, a) => s + assetInvested(a), 0);
  const current = assets.reduce((s, a) => s + assetCurrentValue(a), 0);
  const pl = current - invested;
  const plPct = invested > 0 ? (pl / invested) * 100 : 0;
  const year = new Date().getFullYear();
  const dividendsYear = dividends
    .filter((d) => new Date(d.paid_at).getFullYear() === year)
    .reduce((s, d) => s + d.amount, 0);

  const byClass = (Object.keys(CLASS_LABELS) as AssetClass[])
    .map((c) => ({
      class: c,
      label: CLASS_LABELS[c],
      value: assets.filter((a) => a.class === c).reduce((s, a) => s + assetCurrentValue(a), 0),
    }))
    .filter((x) => x.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Visão global do seu portefólio de investimentos."
        actions={
          <Button
            variant="outline"
            onClick={refreshPrices}
            disabled={refreshing}
            title="Obter cotações do Yahoo Finance"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Atualizar preços
          </Button>
        }
      />

      {!isLoading && assets.length === 0 ? (
        <EmptyState
          title="O seu portefólio está vazio"
          description="Comece por adicionar um ETF, REIT, ação ou outro ativo."
          action={
            <Link to="/etfs">
              <Button>
                <Plus className="h-4 w-4" />
                Adicionar primeiro ativo
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
            <MetricCard label="Valor total" value={formatEUR(current, hidden)} />
            <MetricCard label="Total investido" value={formatEUR(invested, hidden)} />
            <MetricCard
              label="Ganho/Perda"
              value={formatEUR(pl, hidden)}
              sub={formatPercent(plPct, hidden)}
              tone={pl > 0 ? "positive" : pl < 0 ? "negative" : "default"}
            />
            <MetricCard label={`Dividendos ${year}`} value={formatEUR(dividendsYear, hidden)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <PieIcon className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Alocação por classe</h2>
              </div>
              {byClass.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Sem dados para mostrar.
                </p>
              ) : (
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                  <div className="h-52 w-52 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={byClass}
                          dataKey="value"
                          nameKey="label"
                          innerRadius={55}
                          outerRadius={90}
                          strokeWidth={0}
                        >
                          {byClass.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: number) => formatEUR(v, hidden)}
                          contentStyle={{
                            background: "var(--color-popover)",
                            border: "1px solid var(--color-border)",
                            borderRadius: "0.5rem",
                            color: "var(--color-foreground)",
                            fontSize: "0.8rem",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="w-full space-y-2">
                    {byClass.map((c, i) => (
                      <li key={c.class} className="flex items-center gap-2 text-sm">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                        <Link
                          to={CLASS_ROUTES[c.class]}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {c.label}
                        </Link>
                        <span className="ml-auto font-medium">
                          {formatEUR(c.value, hidden)}
                        </span>
                        <span className="w-14 text-right text-xs text-muted-foreground">
                          {current > 0 ? ((c.value / current) * 100).toFixed(1) : "0"}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold">Posições por classe</h2>
              <ul className="space-y-2.5">
                {(Object.keys(CLASS_LABELS) as AssetClass[]).map((c) => {
                  const count = assets.filter((a) => a.class === c).length;
                  const value = assets
                    .filter((a) => a.class === c)
                    .reduce((s, a) => s + assetCurrentValue(a), 0);
                  return (
                    <li key={c}>
                      <Link
                        to={CLASS_ROUTES[c]}
                        className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-3 transition-colors hover:bg-accent/50"
                      >
                        <span className="text-sm font-medium">{CLASS_LABELS[c]}</span>
                        <span className="text-sm text-muted-foreground">
                          {count} {count === 1 ? "posição" : "posições"} ·{" "}
                          <span className="font-medium text-foreground">
                            {formatEUR(value, hidden)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
