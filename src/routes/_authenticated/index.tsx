import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus,
  RefreshCw,
  PieChart as PieIcon,
  TrendingUp,
  TrendingDown,
  Globe,
  Coins,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { listAssets, listDividends, listTransactions } from "@/lib/portfolio.functions";
import { getExposure } from "@/lib/exposure.functions";
import { updateAllPrices } from "@/lib/prices.functions";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { type Asset, type AssetClass, CLASS_LABELS } from "@/lib/portfolio-types";
import type { DividendRecord } from "@/lib/dividends";
import {
  type PeriodKey,
  PERIOD_LABELS,
  allocationByClass,
  assetPerformance,
  bestPerformers,
  buildTimeline,
  dividendSummary,
  granularityFor,
  periodRange,
  portfolioSummary,
  realizedInRange,
  worstPerformers,
} from "@/lib/dashboard";
import { formatEUR, formatPercent } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { PageHeader, MetricCard, EmptyState, Button } from "@/components/ui-bits";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Portefólio Tracker" },
      {
        name: "description",
        content:
          "Cockpit do portefólio: valor total, resultado realizado e latente, dividendos, alocação, exposição e desempenho por ativo.",
      },
      { property: "og:title", content: "Dashboard — Portefólio Tracker" },
      {
        property: "og:description",
        content: "Visão consolidada do teu portefólio de investimentos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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

const TOOLTIP_STYLE = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  color: "var(--color-foreground)",
  fontSize: "0.8rem",
};

const PERIODS: PeriodKey[] = ["today", "month", "ytd", "1y", "all"];

function Card({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </div>
  );
}

function NoData({ label = "Dados não disponíveis" }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}

function DashboardPage() {
  const { hidden } = usePrivateMode();
  const fetchAssets = useServerFn(listAssets);
  const fetchDividends = useServerFn(listDividends);
  const fetchTransactions = useServerFn(listTransactions);
  const fetchExposure = useServerFn(getExposure);
  const refreshFn = useServerFn(updateAllPrices);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("ytd");

  const refreshPrices = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const toastId = toast.loading("A obter cotações...");
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
  const { data: txRaw } = useQuery({
    queryKey: ["transactions", "all"],
    queryFn: () => fetchTransactions({ data: { assetId: null } }),
  });
  const { data: exposureRaw } = useQuery({
    queryKey: ["exposure"],
    queryFn: () => fetchExposure(),
  });

  const assets = (assetsRaw ?? []) as Asset[];
  const dividends = (dividendsRaw ?? []) as unknown as DividendRecord[];
  const transactions = (txRaw ?? []) as Array<{
    type: string;
    traded_at: string;
    quantity: number;
    price: number;
    fee: number | null;
    realized_pl: number | null;
  }>;

  const range = useMemo(() => periodRange(period), [period]);
  const summary = useMemo(() => portfolioSummary(assets, dividends), [assets, dividends]);
  const allocation = useMemo(() => allocationByClass(assets), [assets]);
  const perf = useMemo(() => assetPerformance(assets), [assets]);
  const best = useMemo(() => bestPerformers(perf, 5), [perf]);
  const worst = useMemo(() => worstPerformers(perf, 5), [perf]);
  const timeline = useMemo(
    () => buildTimeline(transactions, dividends, range, granularityFor(period)),
    [transactions, dividends, range, period],
  );
  const divs = useMemo(() => dividendSummary(dividends, range), [dividends, range]);
  const realizedPeriod = useMemo(() => realizedInRange(transactions, range), [transactions, range]);

  const exposure = exposureRaw as
    | {
        report: {
          countries: Array<{ value: string; amount: number; pct: number }>;
          sectors: Array<{ value: string; amount: number; pct: number }>;
          companies: Array<{ name: string; amount: number; pct: number }>;
        };
      }
    | undefined;

  const year = new Date().getFullYear();

  if (!isLoading && assets.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" subtitle="Visão global do seu portefólio de investimentos." />
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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Visão consolidada — detalhe nas páginas de posições, exposição e dividendos."
        actions={
          <Button
            variant="outline"
            onClick={refreshPrices}
            disabled={refreshing}
            title="Obter cotações"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Atualizar preços
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <MetricCard label="Valor atual" value={formatEUR(summary.currentValue, hidden)} />
        <MetricCard
          label="Capital investido"
          value={formatEUR(summary.costBasis, hidden)}
          sub={`${summary.openPositions} posições abertas`}
        />
        <MetricCard
          label="Não realizado"
          value={formatEUR(summary.unrealizedPL, hidden)}
          sub={formatPercent(summary.unrealizedPct, hidden)}
          tone={
            summary.unrealizedPL > 0
              ? "positive"
              : summary.unrealizedPL < 0
                ? "negative"
                : "default"
          }
        />
        <MetricCard
          label="Realizado"
          value={formatEUR(summary.realizedPL, hidden)}
          sub={`${summary.closedPositions} posições fechadas`}
          tone={
            summary.realizedPL > 0 ? "positive" : summary.realizedPL < 0 ? "negative" : "default"
          }
        />
        <MetricCard
          label="Dividendos recebidos"
          value={formatEUR(summary.dividendsReceived, hidden)}
          sub={
            summary.dividendsScheduled > 0
              ? `${formatEUR(summary.dividendsScheduled, hidden)} projetados`
              : "líquidos, sem projeções"
          }
        />
        <MetricCard
          label="Resultado histórico"
          value={formatEUR(summary.totalResult, hidden)}
          sub="realizado + latente + dividendos"
          tone={
            summary.totalResult > 0 ? "positive" : summary.totalResult < 0 ? "negative" : "default"
          }
        />
        <MetricCard
          label="Rentabilidade total"
          value={
            summary.totalReturnPct === null
              ? "Dados não disponíveis"
              : formatPercent(summary.totalReturnPct, hidden)
          }
          sub={`sobre ${formatEUR(summary.returnBasis, hidden)} de capital aplicado`}
          tone={
            (summary.totalReturnPct ?? 0) > 0
              ? "positive"
              : (summary.totalReturnPct ?? 0) < 0
                ? "negative"
                : "default"
          }
        />
        <MetricCard
          label="Yield sobre custo (12m)"
          value={
            summary.yieldOnCost === null
              ? "Dados não disponíveis"
              : formatPercent(summary.yieldOnCost, hidden)
          }
          sub="dividendos líquidos / custo atual"
        />
      </div>

      {/* Período */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Período</span>
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              period === p
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <MetricCard label="Dividendos no período" value={formatEUR(divs.period, hidden)} />
        <MetricCard
          label="Realizado no período"
          value={formatEUR(realizedPeriod, hidden)}
          tone={realizedPeriod > 0 ? "positive" : realizedPeriod < 0 ? "negative" : "default"}
        />
        <MetricCard label={`Dividendos ${year}`} value={formatEUR(divs.year, hidden)} />
        <MetricCard label="Dividendos (total)" value={formatEUR(divs.total, hidden)} />
      </div>

      {/* Evolução */}
      <Card
        title="Evolução (movimentos registados)"
        icon={<TrendingUp className="h-4 w-4 text-primary" />}
      >
        {timeline.length < 2 ? (
          <NoData label="Sem histórico suficiente no período selecionado." />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: 11 }}
                  stroke="var(--color-muted-foreground)"
                />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" width={60} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, name) => [formatEUR(v, hidden), name]}
                />
                <Area
                  type="monotone"
                  dataKey="invested"
                  name="Capital investido"
                  stroke="var(--color-chart-1)"
                  fill="var(--color-chart-1)"
                  fillOpacity={0.15}
                />
                <Area
                  type="monotone"
                  dataKey="dividends"
                  name="Dividendos acumulados"
                  stroke="var(--color-chart-3)"
                  fill="var(--color-chart-3)"
                  fillOpacity={0.15}
                />
                <Area
                  type="monotone"
                  dataKey="realized"
                  name="Realizado acumulado"
                  stroke="var(--color-chart-2)"
                  fill="var(--color-chart-2)"
                  fillOpacity={0.15}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Reconstruído a partir de compras, vendas e dividendos registados. Não existem fotografias
          diárias do valor de mercado, por isso o histórico de cotação não é apresentado.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Alocação */}
        <Card title="Alocação por classe" icon={<PieIcon className="h-4 w-4 text-primary" />}>
          {allocation.length === 0 ? (
            <NoData />
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-52 w-52 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={allocation}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={55}
                      outerRadius={90}
                      strokeWidth={0}
                    >
                      {allocation.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatEUR(v, hidden)}
                      contentStyle={TOOLTIP_STYLE}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full space-y-2">
                {allocation.map((c, i) => (
                  <li key={c.class} className="flex items-center gap-2 text-sm">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <Link
                      to={CLASS_ROUTES[c.class]}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {CLASS_LABELS[c.class]}
                    </Link>
                    <span className="ml-auto font-medium">{formatEUR(c.value, hidden)}</span>
                    <span className="w-14 text-right text-xs text-muted-foreground">
                      {c.pct.toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* Exposição */}
        <Card
          title="Exposição consolidada"
          icon={<Globe className="h-4 w-4 text-primary" />}
          action={
            <Link to="/exposicao" className="text-xs text-primary hover:underline">
              Ver detalhe
            </Link>
          }
        >
          {!exposure || exposure.report.countries.length === 0 ? (
            <NoData label="Dados não disponíveis — atualize a composição em Exposição." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  [
                    "Países",
                    exposure.report.countries
                      .slice(0, 4)
                      .map((s) => ({ label: s.value, pct: s.pct })),
                  ],
                  [
                    "Setores",
                    exposure.report.sectors
                      .slice(0, 4)
                      .map((s) => ({ label: s.value, pct: s.pct })),
                  ],
                  [
                    "Empresas",
                    exposure.report.companies
                      .slice(0, 4)
                      .map((s) => ({ label: s.name, pct: s.pct })),
                  ],
                ] as Array<[string, Array<{ label: string; pct: number }>]>
              ).map(([title, rows]) => (
                <div key={title}>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {title}
                  </p>
                  <ul className="space-y-1.5">
                    {rows.length === 0 ? (
                      <li className="text-xs text-muted-foreground">Dados não disponíveis</li>
                    ) : (
                      rows.map((r) => (
                        <li key={r.label} className="flex justify-between gap-2 text-xs">
                          <span className="truncate text-muted-foreground">{r.label}</span>
                          <span className="font-medium">{r.pct.toFixed(1)}%</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Melhores */}
        <Card title="Melhores desempenhos" icon={<TrendingUp className="h-4 w-4 text-success" />}>
          {best.length === 0 ? (
            <NoData />
          ) : (
            <ul className="space-y-2">
              {best.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link to={CLASS_ROUTES[r.class]} className="truncate hover:underline">
                    {r.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.weight.toFixed(1)}% da carteira
                  </span>
                  <span className="w-28 shrink-0 text-right font-medium text-success">
                    {formatEUR(r.unrealized, hidden)} ({formatPercent(r.unrealizedPct ?? 0, hidden)}
                    )
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Piores */}
        <Card
          title="Piores desempenhos"
          icon={<TrendingDown className="h-4 w-4 text-destructive" />}
        >
          {worst.length === 0 ? (
            <NoData />
          ) : (
            <ul className="space-y-2">
              {worst.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link to={CLASS_ROUTES[r.class]} className="truncate hover:underline">
                    {r.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.weight.toFixed(1)}% da carteira
                  </span>
                  <span
                    className={cn(
                      "w-28 shrink-0 text-right font-medium",
                      r.unrealized < 0 ? "text-destructive" : "text-success",
                    )}
                  >
                    {formatEUR(r.unrealized, hidden)} ({formatPercent(r.unrealizedPct ?? 0, hidden)}
                    )
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Dividendos por mês */}
        <Card
          title="Dividendos por mês"
          icon={<Coins className="h-4 w-4 text-primary" />}
          action={
            <Link to="/dividendos" className="text-xs text-primary hover:underline">
              Ver detalhe
            </Link>
          }
        >
          {divs.byMonth.length === 0 ? (
            <NoData label="Ainda não há dividendos recebidos." />
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={divs.byMonth.slice(-18)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="key"
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted-foreground)"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted-foreground)"
                    width={55}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number) => formatEUR(v, hidden)}
                  />
                  <Bar
                    dataKey="amount"
                    name="Dividendos"
                    fill="var(--color-chart-3)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Dividendos por ativo */}
        <Card title="Dividendos por ativo" icon={<Coins className="h-4 w-4 text-primary" />}>
          {divs.byAsset.length === 0 ? (
            <NoData label="Ainda não há dividendos recebidos." />
          ) : (
            <ul className="space-y-2">
              {divs.byAsset.slice(0, 8).map((r) => (
                <li
                  key={r.assetId ?? r.assetName}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="truncate">{r.assetName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.count} pagamentos
                  </span>
                  <span className="w-24 shrink-0 text-right font-medium">
                    {formatEUR(r.total, hidden)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Resumo por classe (drill-down) */}
      <Card title="Posições por classe">
        <ul className="grid gap-2 sm:grid-cols-2">
          {allocation.map((c) => (
            <li key={c.class}>
              <Link
                to={CLASS_ROUTES[c.class]}
                className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <span className="text-sm font-medium">{CLASS_LABELS[c.class]}</span>
                <span className="text-sm text-muted-foreground">
                  {c.count} {c.count === 1 ? "posição" : "posições"} ·{" "}
                  <span className="font-medium text-foreground">{formatEUR(c.value, hidden)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
