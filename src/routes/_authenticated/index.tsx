import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Coins,
  Flame,
  Globe,
  ChevronRight,
  PieChart as PieIcon,
  Plus,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { Pie, PieChart, Cell, Tooltip, XAxis, YAxis, CartesianGrid, BarChart, Bar } from "recharts";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { listPortfolioSnapshots } from "@/lib/snapshots.functions";
import { getDividendCalendar } from "@/lib/insights.functions";
import { PassiveIncomeCard } from "@/components/passive-income-card";
import { DashboardHero, DashboardHeroSkeleton } from "@/components/dashboard-hero";
import { heroSeries, periodChange } from "@/lib/dashboard-period";
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
  allocationByClass,
  assetPerformance,
  bestPerformers,
  dividendSummary,
  periodRange,
  portfolioSummary,
  realizedInRange,
  todayISO,
  worstPerformers,
} from "@/lib/dashboard";
import {
  countryNamePt,
  formatCompact,
  formatDatePt,
  formatDayLongPt,
  formatEUR,
  formatNumber,
  formatPct,
  formatPercent,
  formatPeriodKey,
  formatTimePt,
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
  Modal,
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

/** Cotações com mais de 3 dias consideram-se desatualizadas. */
const STALE_PRICE_DAYS = 3;

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

function AlertList({ alerts }: { alerts: DataQualityAlert[] }) {
  return (
    <ul className="divide-y divide-border">
      {alerts.map((a, i) => (
        <li key={`${a.code}-${a.assetId ?? i}`} className="flex items-start gap-3 py-2.5">
          <Badge
            tone={a.severity === "error" ? "loss" : a.severity === "warning" ? "warn" : "info"}
            className="mt-0.5 shrink-0"
          >
            <ShieldAlert aria-hidden className="h-3 w-3" />
            {a.severity === "error" ? "Erro" : a.severity === "warning" ? "Aviso" : "Info"}
          </Badge>
          <p className="min-w-0 text-sm">{a.message}</p>
        </li>
      ))}
    </ul>
  );
}

/** Faixa de avisos no topo: resumo numa linha; "Rever" abre a lista completa. */
function AlertsStrip({
  alerts,
  expanded,
  onToggle,
  modalOpen,
  onModalOpenChange,
}: {
  alerts: DataQualityAlert[];
  expanded: boolean;
  onToggle: () => void;
  modalOpen: boolean;
  onModalOpenChange: (open: boolean) => void;
}) {
  const n = alerts.length;
  const title = `${n} ${n === 1 ? "aviso" : "avisos"} nos teus dados`;
  const preview = alerts.slice(0, 2).map((a) => a.message);
  const extra = n - preview.length;
  const panelId = "alerts-strip-panel";
  return (
    <section aria-label="Avisos aos dados" className="space-y-2">
      <div className="flex items-center gap-3 rounded-[10px] border border-warning/20 bg-warning/[0.08] px-3.5 py-2.5">
        <TriangleAlert aria-hidden className="h-4 w-4 shrink-0 text-warning" />
        {/* Desktop: resumo + botão Rever */}
        <p className="hidden min-w-0 flex-1 truncate text-[13.5px] md:block">
          <strong className="font-semibold">{title}.</strong>{" "}
          <span className="text-muted-foreground">
            {preview.join(" · ")}
            {extra > 0 && ` · +${extra}`}
          </span>
        </p>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          className="hidden shrink-0 rounded-md bg-foreground/[0.06] px-2.5 py-1 text-[13px] font-medium transition-colors hover:bg-foreground/10 md:inline-flex"
        >
          {expanded ? "Fechar" : "Rever"}
        </button>
        {/* Mobile: toda a linha abre uma folha com a lista */}
        <button
          type="button"
          onClick={() => onModalOpenChange(true)}
          className="-my-2.5 flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-left text-[13.5px] font-semibold md:hidden"
        >
          {title}
          <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
      {expanded && (
        <div
          id={panelId}
          className="hidden rounded-xl border border-border bg-card px-4 py-2 md:block"
        >
          <AlertList alerts={alerts} />
        </div>
      )}
      <Modal open={modalOpen} onClose={() => onModalOpenChange(false)} title={title}>
        <AlertList alerts={alerts} />
      </Modal>
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
  const fetchSnapshots = useServerFn(listPortfolioSnapshots);
  const fetchCalendar = useServerFn(getDividendCalendar);
  const refreshFn = useServerFn(updateAllPrices);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("ytd");
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);

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
  const { data: calendar } = useQuery({
    queryKey: ["dividend-calendar", 12],
    queryFn: () => fetchCalendar({ data: { months: 12 } }),
  });
  const { data: snapshotsRaw } = useQuery({
    queryKey: ["portfolio-snapshots"],
    queryFn: () => fetchSnapshots(),
  });
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
  const divs = useMemo(() => dividendSummary(dividends, range), [dividends, range]);
  const last12 = useMemo(() => dividendSummary(dividends, periodRange("1y")).period, [dividends]);
  const realizedPeriod = useMemo(() => realizedInRange(transactions, range), [transactions, range]);
  const snapshots = useMemo(() => snapshotsRaw ?? [], [snapshotsRaw]);
  const change = useMemo(
    () =>
      periodChange({
        isAll: period === "all",
        range,
        today: todayISO(),
        currentValue: summary.currentValue,
        totalResult: summary.totalResult,
        totalReturnPct: summary.totalReturnPct,
        snapshots,
        transactions,
        dividends,
      }),
    [period, range, summary, snapshots, transactions, dividends],
  );
  const heroPoints = useMemo(() => heroSeries(snapshots, range, todayISO()), [snapshots, range]);

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

  const refreshButton = (
    <Button
      variant="outline"
      onClick={refreshPrices}
      loading={refreshing}
      title="Obter cotações"
      className="sm:min-h-[34px] sm:py-1"
    >
      {!refreshing && <RefreshCw aria-hidden className="h-[15px] w-[15px]" />}
      Atualizar
    </Button>
  );

  const pricesLabel = (() => {
    if (!freshness.latest) return "Sem cotações registadas";
    const sameDay = formatDatePt(freshness.latest) === formatDatePt(new Date().toISOString());
    return sameDay
      ? `Cotações de hoje, ${formatTimePt(freshness.latest)}`
      : `Cotações de ${formatDatePt(freshness.latest)}`;
  })();
  // A faixa só aparece quando há algo a tratar (avisos ou cotações em atraso).
  const showAlertsStrip = alerts.length > 0;

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
        <DashboardHeroSkeleton />
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
        meta={formatDayLongPt()}
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  freshness.latest ? "bg-success" : "bg-muted-foreground",
                )}
              />
              {pricesLabel}
            </span>
            {freshness.stale > 0 && (
              <Badge tone="warn">
                <AlertTriangle aria-hidden className="h-3 w-3" />
                {freshness.stale} {freshness.stale === 1 ? "desatualizada" : "desatualizadas"}
              </Badge>
            )}
            {refreshButton}
          </>
        }
      />

      {showAlertsStrip && (
        <AlertsStrip
          alerts={alerts}
          expanded={showAllAlerts}
          onToggle={() => setShowAllAlerts((v) => !v)}
          modalOpen={alertsModalOpen}
          onModalOpenChange={setAlertsModalOpen}
        />
      )}

      <DashboardHero
        period={period}
        onPeriodChange={setPeriod}
        summary={summary}
        change={change}
        rangeFrom={range.from}
        realizedPeriod={realizedPeriod}
        series={heroPoints}
        hidden={hidden}
      />

      <PassiveIncomeCard
        byMonth={divs.byMonth}
        last12={last12}
        yieldOnCost={summary.yieldOnCost}
        sinceStart={divs.total}
        upcoming={calendar?.events}
        hidden={hidden}
      />

      {/* 2 · Estou no caminho? */}
      <Section
        id="sec-caminho"
        title="Estou no caminho?"
        hint="Objetivo de independência financeira (FIRE)"
      >
        <div className="grid gap-4">
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

      {/* 4 · Desempenho */}
      <div className="space-y-4">
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
      </div>
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
