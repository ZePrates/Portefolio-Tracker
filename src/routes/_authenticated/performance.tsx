import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { listAssets, listDividends, listTransactions } from "@/lib/portfolio.functions";
import { type PeriodKey, PERIOD_LABELS, periodRange } from "@/lib/dashboard";
import {
  METHODOLOGY_LABELS,
  buildLedgerSeries,
  contributionByAsset,
  drawdown,
  performanceByClass,
  periodPerformance,
  type PerfTransaction,
} from "@/lib/performance";
import type { Asset } from "@/lib/portfolio-types";
import type { DividendRecord } from "@/lib/dividends";
import { formatEUR } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { Button, EmptyState, MetricCard, PageHeader } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({
    meta: [
      { title: "Performance — Portefólio Tracker" },
      {
        name: "description",
        content:
          "Análise histórica do portefólio: retorno absoluto e percentual, TWR, MWR, contribuição por ativo, desempenho por classe e drawdown.",
      },
      { property: "og:title", content: "Performance — Portefólio Tracker" },
      {
        property: "og:description",
        content: "Retorno, contribuição por ativo e desempenho por classe do teu portefólio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PerformancePage,
});

const PERIODS: PeriodKey[] = ["today", "month", "ytd", "1y", "all"];

const TOOLTIP_STYLE = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  color: "var(--color-foreground)",
  fontSize: "0.8rem",
};

function Card({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

const pct = (v: number | null, hidden: boolean) =>
  hidden ? "••" : v == null ? "Dados não disponíveis" : `${v.toFixed(2).replace(".", ",")}%`;

function PerformancePage() {
  const { hidden } = usePrivateMode();
  const [period, setPeriod] = useState<PeriodKey>("all");

  const assetsQ = useQuery({ queryKey: ["assets"], queryFn: () => listAssets() });
  const txQ = useQuery({ queryKey: ["transactions"], queryFn: () => listTransactions({}) });
  const divQ = useQuery({ queryKey: ["dividends"], queryFn: () => listDividends() });

  const assets = (assetsQ.data ?? []) as Asset[];
  const transactions = (txQ.data ?? []) as PerfTransaction[];
  const dividends = (divQ.data ?? []) as DividendRecord[];
  const loading = assetsQ.isLoading || txQ.isLoading || divQ.isLoading;

  const range = useMemo(() => periodRange(period), [period]);

  const perf = useMemo(
    () => periodPerformance(assets, transactions, dividends, range),
    [assets, transactions, dividends, range],
  );
  const series = useMemo(
    () => buildLedgerSeries(transactions, dividends),
    [transactions, dividends],
  );
  const contributions = useMemo(
    () => contributionByAsset(assets, transactions, dividends, range),
    [assets, transactions, dividends, range],
  );
  const classes = useMemo(
    () => performanceByClass(assets, dividends, range),
    [assets, dividends, range],
  );
  // Drawdown só é calculável sobre séries reais de valor de mercado.
  const dd = useMemo(() => drawdown([]), []);

  const chart = useMemo(
    () =>
      series
        .filter((p) => p.date >= range.from && p.date <= range.to)
        .map((p) => ({
          date: p.date,
          "Capital investido": Math.round(p.netInvested),
          "Realizado acumulado": Math.round(p.realized),
          "Dividendos acumulados": Math.round(p.dividends),
        })),
    [series, range],
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">A carregar…</p>;
  }

  if (assets.length === 0 && transactions.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Performance" subtitle="Análise histórica do portefólio" />
        <EmptyState
          title="Sem histórico"
          description="Ainda não existem transações registadas para analisar o desempenho."
        />
      </div>
    );
  }

  const tone = (v: number) => (v > 0 ? "positive" : v < 0 ? "negative" : "default");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance"
        subtitle="Retorno, contribuição e desempenho histórico — calculado a partir do ledger real"
        actions={
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
            {PERIODS.map((p) => (
              <Button
                key={p}
                variant="ghost"
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-3 py-1.5 text-xs",
                  period === p && "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {PERIOD_LABELS[p]}
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Resultado do período"
          value={formatEUR(perf.absolute, hidden)}
          sub={`Retorno simples: ${pct(perf.simplePct, hidden)}`}
          tone={tone(perf.absolute)}
        />
        <MetricCard
          label="Não realizado"
          value={formatEUR(perf.unrealized, hidden)}
          sub="Posições abertas"
          tone={tone(perf.unrealized)}
        />
        <MetricCard
          label="Realizado"
          value={formatEUR(perf.realized, hidden)}
          sub="Vendas (FIFO)"
          tone={tone(perf.realized)}
        />
        <MetricCard
          label="Dividendos"
          value={formatEUR(perf.dividends, hidden)}
          sub="Recebidos no período"
          tone={tone(perf.dividends)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Retorno ponderado pelo tempo (TWR)"
          note={METHODOLOGY_LABELS["twr"] + " — neutraliza o efeito de aportes e levantamentos."}
        >
          {perf.twr.totalPct != null ? (
            <p className="text-2xl font-bold">{pct(perf.twr.totalPct, hidden)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Dados não disponíveis — {perf.twr.unavailable ?? "histórico insuficiente"}. São
              necessárias pelo menos duas valorizações reais da carteira.
            </p>
          )}
        </Card>
        <Card
          title="Retorno ponderado pelo capital (MWR / XIRR)"
          note={METHODOLOGY_LABELS["mwr"] + " — considera o momento de cada aporte."}
        >
          {perf.mwr.annualizedPct != null ? (
            <p className="text-2xl font-bold">{pct(perf.mwr.annualizedPct, hidden)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Dados não disponíveis — {perf.mwr.unavailable ?? "fluxos insuficientes"}.
            </p>
          )}
        </Card>
      </div>

      <Card
        title="Evolução do capital"
        note="Derivada do ledger real (compras, vendas e dividendos). Não existem snapshots diários de valor de mercado, pelo que o valor histórico da carteira não é estimado."
      >
        {chart.length < 2 ? (
          <p className="text-sm text-muted-foreground">Dados não disponíveis para este período.</p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area
                  type="monotone"
                  dataKey="Capital investido"
                  stroke="var(--color-chart-1)"
                  fill="var(--color-chart-1)"
                  fillOpacity={0.15}
                />
                <Area
                  type="monotone"
                  dataKey="Realizado acumulado"
                  stroke="var(--color-chart-2)"
                  fill="var(--color-chart-2)"
                  fillOpacity={0.15}
                />
                <Area
                  type="monotone"
                  dataKey="Dividendos acumulados"
                  stroke="var(--color-chart-3)"
                  fill="var(--color-chart-3)"
                  fillOpacity={0.15}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Contribuição por ativo"
          note="Separa valorização latente, realização de vendas (FIFO) e dividendos."
        >
          {contributions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Dados não disponíveis.</p>
          ) : (
            <ul className="space-y-2">
              {contributions.slice(0, 10).map((c) => (
                <li
                  key={c.assetId ?? c.name}
                  className="rounded-lg border border-border/60 px-4 py-2.5"
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{c.name}</span>
                    <span className={cn(c.total >= 0 ? "text-success" : "text-destructive")}>
                      {formatEUR(c.total, hidden)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Valorização {formatEUR(c.appreciation, hidden)} · Realizado{" "}
                    {formatEUR(c.realized, hidden)} · Dividendos {formatEUR(c.dividends, hidden)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Desempenho por classe">
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Dados não disponíveis.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2">Classe</th>
                    <th className="py-2 text-right">Valor</th>
                    <th className="py-2 text-right">Resultado</th>
                    <th className="py-2 text-right">Retorno</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((c) => (
                    <tr key={c.class} className="border-t border-border/60">
                      <td className="py-2">{c.label}</td>
                      <td className="py-2 text-right">{formatEUR(c.value, hidden)}</td>
                      <td
                        className={cn(
                          "py-2 text-right",
                          c.totalResult >= 0 ? "text-success" : "text-destructive",
                        )}
                      >
                        {formatEUR(c.totalResult, hidden)}
                      </td>
                      <td className="py-2 text-right">{pct(c.returnPct, hidden)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Drawdown"
        note="Máxima queda desde um máximo histórico. Requer série real de valor de mercado."
      >
        {dd.maxDrawdownPct == null ? (
          <p className="text-sm text-muted-foreground">
            Dados não disponíveis — {dd.unavailable ?? "sem histórico de valorizações"}.
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm">
              Máximo: {pct(dd.maxDrawdownPct, hidden)} · Atual: {pct(dd.currentDrawdownPct, hidden)}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
