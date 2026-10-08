import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Coins,
  Flame,
  Globe,
  Info,
  PieChart as PieIcon,
  Plus,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Pie,
  PieChart,
  Cell,
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { listAssets, listDividends, listTransactions } from "@/lib/portfolio.functions";
import { getExposure } from "@/lib/exposure.functions";
import { updateAllPrices } from "@/lib/prices.functions";
import { getFireProgress } from "@/lib/goals.functions";
import { getDataQualityAlerts } from "@/lib/data-quality.functions";
import type { DataQualityAlert } from "@/lib/data-quality";
import { cn } from "@/lib/utils";
import { type Asset, type AssetClass, CLASS_LABELS, isOpenPosition } from "@/lib/portfolio-types";
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
import {
  countryNamePt,
  formatCompact,
  formatDatePt,
  formatEUR,
  formatEURCompact,
  formatNumber,
  formatPct,
  formatPercent,
  formatPeriodKey,
  sectorNamePt,
} from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import {
  Badge,
  Button,
  Card,
  Delta,
  EmptyState,
  ErrorState,
  KpiGridSkeleton,
  MetricCard,
  PageHeader,
} from "@/components/ui-bits";
import {
  AXIS_LINE,
  AXIS_TICK,
  CHART_COLORS,
  CLASS_COLOR,
  ChartFrame,
  ChartTooltip,
  GRID_PROPS,
} from "@/components/chart-kit";

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

const PERIODS: PeriodKey[] = ["today", "month", "ytd", "1y", "all"];

/** Cotações com mais de 3 dias consideram-se desatualizadas. */
const STALE_PRICE_DAYS = 3;

const toneOf = (n: number): "positive" | "negative" | "default" =>
  n > 0 ? "positive" : n < 0 ? "negative" : "default";

function NoData({ label = "Dados não disponíveis" }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}

/** Secção do dashboard: uma pergunta do investidor e as respostas. */
function Section({
  id,
  title,
  hint,
  action,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function DashboardPage() {
  const { hidden } = usePrivateMode();
  const fetchAssets = useServerFn(listAssets);
  const fetchDividends = useServerFn(listDividends);
  const fetchTransactions = useServerFn(listTransactions);
  const fetchExposure = useServerFn(getExposure);
  const fetchFire = useServerFn(getFireProgress);
  const fetchAlerts = useServerFn(getDataQualityAlerts);
  const refreshFn = useServerFn(updateAllPrices);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("ytd");
  const [showAllAlerts, setShowAllAlerts] = useState(false);

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
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-snapshots"] });
      await queryClient.invalidateQueries({ queryKey: ["fire"] });
      await queryClient.invalidateQueries({ queryKey: ["data-quality"] });
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

  const {
    data: assetsRaw,
    isLoading,
    isError,
    refetch,
  } = useQuery({
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
  const { data: fire } = useQuery({ queryKey: ["fire"], queryFn: () => fetchFire() });
  const { data: alertsData } = useQuery({
    queryKey: ["data-quality"],
    queryFn: () => fetchAlerts(),
  });

  const assets = useMemo(() => (assetsRaw ?? []) as Asset[], [assetsRaw]);
  const dividends = useMemo(
    () => (dividendsRaw ?? []) as unknown as DividendRecord[],
    [dividendsRaw],
  );
  const transactions = useMemo(
    () =>
      (txRaw ?? []) as Array<{
        type: string;
        traded_at: string;
        quantity: number;
        price: number;
        fee: number | null;
        realized_pl: number | null;
      }>,
    [txRaw],
  );

  const summary = useMemo(
    () => portfolioSummary(assets, dividends, undefined, transactions),
    [assets, dividends, transactions],
  );
  const range = useMemo(() => periodRange(period), [period]);

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

  // Frescura das cotações: quando foi a última e quantas estão desatualizadas.
  const freshness = useMemo(() => {
    const priced = assets.filter((a) => isOpenPosition(a) && a.class !== "p2p");
    const dates = priced
      .map((a) => (a.price_updated_at ? new Date(a.price_updated_at).getTime() : 0))
      .filter((t) => t > 0);
    const latest = dates.length > 0 ? Math.max(...dates) : null;
    const cutoff = Date.now() - STALE_PRICE_DAYS * 86_400_000;
    const stale = priced.filter(
      (a) => !a.price_updated_at || new Date(a.price_updated_at).getTime() < cutoff,
    ).length;
    return { latest: latest ? new Date(latest).toISOString() : null, stale };
  }, [assets]);

  const exposure = exposureRaw as
    | {
        report: {
          country: Array<{ value: string; amount: number; pct: number }>;
          sector: Array<{ value: string; amount: number; pct: number }>;
          companies: Array<{ name: string; amount: number; pct: number }>;
        };
      }
    | undefined;

  const alerts = (alertsData?.alerts ?? []) as DataQualityAlert[];
  const year = new Date().getFullYear();

  const refreshButton = (
    <Button variant="outline" onClick={refreshPrices} loading={refreshing} title="Obter cotações">
      {!refreshing && <RefreshCw aria-hidden className="h-4 w-4" />}
      Atualizar preços
    </Button>
  );

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" />
        <ErrorState onRetry={() => void refetch()} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title="Dashboard" subtitle="A carregar a carteira…" />
        <KpiGridSkeleton count={4} />
        <KpiGridSkeleton count={4} />
        <ChartFrame label="A carregar gráfico" loading height={256}>
          <></>
        </ChartFrame>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" subtitle="Visão global do teu portefólio de investimentos." />
        <EmptyState
          title="O teu portefólio está vazio"
          description="Começa por adicionar um ETF, REIT, ação ou outro ativo."
          action={
            <Link to="/etfs">
              <Button>
                <Plus aria-hidden className="h-4 w-4" />
                Adicionar primeiro ativo
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const fireProgress = fire?.progress ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        subtitle="Visão consolidada — o detalhe está nas páginas de posições, exposição e dividendos."
        actions={refreshButton}
      />

      {/* 1 · Quanto tenho */}
      <Section
        id="sec-valor"
        title="Quanto tenho"
        hint={
          freshness.latest
            ? `Cotações de ${formatDatePt(freshness.latest)}`
            : "Sem cotações registadas"
        }
        action={
          freshness.stale > 0 ? (
            <Badge tone="warn">
              <AlertTriangle aria-hidden className="h-3 w-3" />
              {freshness.stale} {freshness.stale === 1 ? "ativo" : "ativos"} com cotação
              desatualizada
            </Badge>
          ) : undefined
        }
      >
        <div className="grid gap-3 md:gap-4 lg:grid-cols-3">
          <div className="min-w-0 rounded-xl border border-border bg-card p-5 lg:col-span-2 md:p-6">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Valor atual
            </p>
            <p className="num mt-2 break-words text-3xl font-bold md:text-4xl">
              {formatEUR(summary.currentValue, hidden)}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Não realizado</dt>
                <dd className="mt-0.5">
                  <Delta value={summary.unrealizedPL}>
                    {formatEUR(summary.unrealizedPL, hidden)}{" "}
                    <span className="text-xs">
                      ({formatPercent(summary.unrealizedPct, hidden)})
                    </span>
                  </Delta>
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Realizado</dt>
                <dd className="num mt-0.5 font-medium">
                  {formatEUR(summary.realizedPL, hidden)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    · {summary.closedPositions} fechadas
                  </span>
                </dd>
              </div>
            </dl>
          </div>
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-1">
            <MetricCard
              label="Capital investido"
              value={formatEUR(summary.costBasis, hidden)}
              sub={`${summary.openPositions} posições abertas`}
            />
            <MetricCard
              label="Rentabilidade total"
              value={
                summary.totalReturnPct === null
                  ? "Sem dados"
                  : formatPercent(summary.totalReturnPct, hidden)
              }
              sub={`sobre ${formatEUR(summary.returnBasis, hidden)} aplicados`}
              tone={toneOf(summary.totalReturnPct ?? 0)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
          <MetricCard
            label="Resultado histórico"
            value={formatEUR(summary.totalResult, hidden)}
            sub="realizado + latente + dividendos"
            tone={toneOf(summary.totalResult)}
            className="col-span-2 lg:col-span-1"
          />
          <MetricCard
            label="Dividendos recebidos"
            value={formatEUR(summary.dividendsReceived, hidden)}
            sub={
              summary.dividendsScheduled > 0
                ? `${formatEUR(summary.dividendsScheduled, hidden)} previstos`
                : "líquidos, sem previsões"
            }
          />
          <MetricCard
            label="Yield sobre custo (12 m)"
            value={
              summary.yieldOnCost === null
                ? "Sem dados"
                : formatPercent(summary.yieldOnCost, hidden)
            }
            sub="dividendos líquidos ÷ custo atual"
          />
        </div>
      </Section>

      {/* 2 · Estou no caminho? */}
      <Section
        id="sec-caminho"
        title="Estou no caminho?"
        hint="Objetivo de independência financeira (FIRE)"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            headingLevel={3}
            title="Progresso FIRE"
            icon={<Flame aria-hidden className="h-4 w-4 text-primary" />}
            action={
              <Link to="/objetivos" className="text-primary hover:underline">
                {fireProgress ? "Ver detalhe" : "Definir objetivo"}
              </Link>
            }
          >
            {!fireProgress ? (
              <NoData label="Define as tuas despesas anuais para veres quanto falta para o teu número FIRE." />
            ) : (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="num text-3xl font-bold">
                    {formatPct(fireProgress.progressPct, 1, hidden)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    de {formatEUR(fireProgress.fireNumber, hidden)}
                  </p>
                </div>
                <div
                  role="progressbar"
                  aria-label="Progresso FIRE"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    hidden ? undefined : Math.min(100, Math.round(fireProgress.progressPct))
                  }
                  className="h-2.5 overflow-hidden rounded-full bg-secondary"
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: hidden ? "0%" : `${Math.min(100, fireProgress.progressPct)}%` }}
                  />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Falta</dt>
                    <dd className="num font-medium">{formatEUR(fireProgress.remaining, hidden)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Despesas cobertas por dividendos
                    </dt>
                    <dd className="num font-medium">
                      {formatPct(fireProgress.passiveCoveragePct, 1, hidden)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </Card>

          <Card
            headingLevel={3}
            title="Dividendos por mês"
            icon={<Coins aria-hidden className="h-4 w-4 text-primary" />}
            action={
              <Link to="/dividendos" className="text-primary hover:underline">
                Ver detalhe
              </Link>
            }
          >
            <ChartFrame
              label={`Dividendos recebidos por mês, últimos ${Math.min(18, divs.byMonth.length)} meses`}
              height={208}
              empty={divs.byMonth.length === 0}
              emptyLabel="Ainda não há dividendos recebidos."
            >
              <BarChart data={divs.byMonth.slice(-18)}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis
                  dataKey="key"
                  tick={AXIS_TICK}
                  axisLine={AXIS_LINE}
                  tickLine={false}
                  tickFormatter={(k: string) => formatPeriodKey(k)}
                  minTickGap={16}
                />
                <YAxis
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v: number) => (hidden ? "•" : formatCompact(v))}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-accent)", opacity: 0.4 }}
                  content={
                    <ChartTooltip
                      labelFormatter={(l) => formatPeriodKey(l, true)}
                      valueFormatter={(v) => formatEUR(v, hidden)}
                    />
                  }
                />
                <Bar
                  dataKey="amount"
                  name="Dividendos"
                  fill="var(--color-chart-2)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartFrame>
          </Card>
        </div>
      </Section>

      {/* 3 · Como estou distribuído? */}
      <Section id="sec-distribuicao" title="Como estou distribuído?">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            headingLevel={3}
            title="Alocação por classe"
            icon={<PieIcon aria-hidden className="h-4 w-4 text-primary" />}
            action={
              <Link to="/objetivos" className="text-primary hover:underline">
                Definir alvos
              </Link>
            }
          >
            {allocation.length === 0 ? (
              <NoData />
            ) : (
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <ChartFrame
                  label={`Alocação por classe: ${allocation
                    .map((c) => `${CLASS_LABELS[c.class]} ${formatNumber(c.pct, 1)}%`)
                    .join(", ")}`}
                  height={200}
                  className="w-full shrink-0 sm:w-48"
                >
                  <PieChart>
                    <Pie
                      data={allocation}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={52}
                      outerRadius={86}
                      strokeWidth={0}
                    >
                      {allocation.map((c, i) => (
                        <Cell key={c.class} fill={CLASS_COLOR[c.class] ?? CHART_COLORS[i % 8]} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={<ChartTooltip valueFormatter={(v) => formatEUR(v, hidden)} />}
                    />
                  </PieChart>
                </ChartFrame>
                <ul className="w-full min-w-0 space-y-2">
                  {allocation.map((c) => (
                    <li key={c.class} className="flex items-center gap-2 text-sm">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: CLASS_COLOR[c.class] }}
                      />
                      <Link
                        to={CLASS_ROUTES[c.class]}
                        className="min-w-0 flex-1 truncate text-muted-foreground hover:text-foreground"
                      >
                        {CLASS_LABELS[c.class]}
                      </Link>
                      <span className="num shrink-0 font-medium">{formatEUR(c.value, hidden)}</span>
                      <span className="num w-14 shrink-0 text-right text-xs text-muted-foreground">
                        {formatPct(c.pct, 1, hidden)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card
            headingLevel={3}
            title="Exposição consolidada"
            icon={<Globe aria-hidden className="h-4 w-4 text-primary" />}
            action={
              <Link to="/exposicao" className="text-primary hover:underline">
                Ver detalhe
              </Link>
            }
          >
            {!exposure || exposure.report.country.length === 0 ? (
              <NoData label="Sem dados — atualiza a composição em Exposição." />
            ) : (
              <div className="grid gap-5 sm:grid-cols-3">
                {(
                  [
                    [
                      "Países",
                      exposure.report.country
                        .slice(0, 4)
                        .map((s) => ({ label: countryNamePt(s.value), pct: s.pct })),
                    ],
                    [
                      "Setores",
                      exposure.report.sector
                        .slice(0, 4)
                        .map((s) => ({ label: sectorNamePt(s.value), pct: s.pct })),
                    ],
                    [
                      "Empresas",
                      exposure.report.companies
                        .slice(0, 4)
                        .map((s) => ({ label: s.name, pct: s.pct })),
                    ],
                  ] as Array<[string, Array<{ label: string; pct: number }>]>
                ).map(([title, rows]) => (
                  <div key={title} className="min-w-0">
                    <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {title}
                    </h4>
                    <ul className="space-y-1.5">
                      {rows.length === 0 ? (
                        <li className="text-xs text-muted-foreground">Sem dados</li>
                      ) : (
                        rows.map((r) => (
                          <li key={r.label} className="flex justify-between gap-2 text-xs">
                            <span
                              className="min-w-0 truncate text-muted-foreground"
                              title={r.label}
                            >
                              {r.label}
                            </span>
                            <span className="num shrink-0 font-medium">
                              {formatPct(r.pct, 1, hidden)}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </Section>

      {/* 4 · O que mudou? */}
      <Section
        id="sec-mudou"
        title="O que mudou?"
        action={
          <div role="group" aria-label="Período" className="flex flex-wrap items-center gap-1.5">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  period === p
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
          <MetricCard label="Dividendos no período" value={formatEUR(divs.period, hidden)} />
          <MetricCard
            label="Realizado no período"
            value={formatEUR(realizedPeriod, hidden)}
            tone={toneOf(realizedPeriod)}
          />
          <MetricCard label={`Dividendos ${year}`} value={formatEUR(divs.year, hidden)} />
          <MetricCard label="Dividendos (total)" value={formatEUR(divs.total, hidden)} />
        </div>

        <Card
          headingLevel={3}
          title="Evolução (movimentos registados)"
          icon={<TrendingUp aria-hidden className="h-4 w-4 text-primary" />}
          description="Reconstruída a partir de compras, vendas e dividendos registados; não é o valor de mercado ao longo do tempo."
        >
          <ChartFrame
            label="Evolução do capital investido, dividendos acumulados e resultado realizado no período"
            empty={timeline.length < 2}
            emptyLabel="Sem histórico suficiente no período selecionado."
          >
            <AreaChart data={timeline}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="key"
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                tickFormatter={(k: string) => formatPeriodKey(k)}
                minTickGap={24}
              />
              <YAxis
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={52}
                tickFormatter={(v: number) => (hidden ? "•" : formatEURCompact(v))}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    labelFormatter={(l) => formatPeriodKey(l, true)}
                    valueFormatter={(v) => formatEUR(v, hidden)}
                  />
                }
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
          </ChartFrame>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <PerformanceCard
            title="Melhores desempenhos"
            icon={<TrendingUp aria-hidden className="h-4 w-4 text-success" />}
            rows={best}
            hidden={hidden}
          />
          <PerformanceCard
            title="Piores desempenhos"
            icon={<TrendingDown aria-hidden className="h-4 w-4 text-destructive" />}
            rows={worst}
            hidden={hidden}
          />
        </div>

        <Card
          headingLevel={3}
          title="Dividendos por ativo"
          icon={<Coins aria-hidden className="h-4 w-4 text-primary" />}
        >
          {divs.byAsset.length === 0 ? (
            <NoData label="Ainda não há dividendos recebidos." />
          ) : (
            <ul className="space-y-2">
              {divs.byAsset.slice(0, 8).map((r) => (
                <li
                  key={r.assetId ?? r.assetName}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{r.assetName}</span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {r.count} {r.count === 1 ? "pagamento" : "pagamentos"}
                  </span>
                  <span className="num w-24 shrink-0 text-right font-medium">
                    {formatEUR(r.total, hidden)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      {/* 5 · O que preciso de tratar? */}
      <Section
        id="sec-tratar"
        title="O que preciso de tratar?"
        hint="Verificações automáticas aos teus dados"
      >
        <Card headingLevel={3}>
          {alertsData === undefined ? (
            <NoData label="A verificar os dados…" />
          ) : alerts.length === 0 ? (
            <p className="flex items-center gap-2 py-2 text-sm text-success">
              <Info aria-hidden className="h-4 w-4" />
              Está tudo em ordem: não há avisos nos teus dados.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {(showAllAlerts ? alerts : alerts.slice(0, 4)).map((a, i) => (
                  <li key={`${a.code}-${a.assetId ?? i}`} className="flex items-start gap-3 py-2.5">
                    <Badge
                      tone={
                        a.severity === "error" ? "loss" : a.severity === "warning" ? "warn" : "info"
                      }
                      className="mt-0.5 shrink-0"
                    >
                      <ShieldAlert aria-hidden className="h-3 w-3" />
                      {a.severity === "error"
                        ? "Erro"
                        : a.severity === "warning"
                          ? "Aviso"
                          : "Info"}
                    </Badge>
                    <p className="min-w-0 text-sm">{a.message}</p>
                  </li>
                ))}
              </ul>
              {alerts.length > 4 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  aria-expanded={showAllAlerts}
                  onClick={() => setShowAllAlerts((v) => !v)}
                >
                  {showAllAlerts ? "Mostrar menos" : `Ver os outros ${alerts.length - 4} avisos`}
                </Button>
              )}
            </>
          )}
        </Card>
      </Section>
    </div>
  );
}

function PerformanceCard({
  title,
  icon,
  rows,
  hidden,
}: {
  title: string;
  icon: React.ReactNode;
  rows: ReturnType<typeof bestPerformers>;
  hidden: boolean;
}) {
  return (
    <Card headingLevel={3} title={title} icon={icon}>
      {rows.length === 0 ? (
        <NoData />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link
                  to={CLASS_ROUTES[r.class]}
                  className="block truncate hover:underline"
                  title={r.name}
                >
                  {r.name}
                </Link>
                <p className="num text-xs text-muted-foreground">
                  {formatPct(r.weight, 1, hidden)} da carteira
                </p>
              </div>
              <div className="shrink-0 text-right">
                <Delta value={r.unrealized} className="justify-end">
                  {formatEUR(r.unrealized, hidden)}
                </Delta>
                <p
                  className={cn(
                    "num text-xs",
                    r.unrealized < 0 ? "text-destructive" : "text-success",
                  )}
                >
                  {formatPercent(r.unrealizedPct ?? 0, hidden)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
