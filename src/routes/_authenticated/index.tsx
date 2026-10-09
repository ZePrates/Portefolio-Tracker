import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ChevronRight,
  Plus,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { listPortfolioSnapshots } from "@/lib/snapshots.functions";
import { getDividendCalendar } from "@/lib/insights.functions";
import { PassiveIncomeCard } from "@/components/passive-income-card";
import { AllocationCard } from "@/components/allocation-card";
import { FireCard } from "@/components/fire-card";
import { ExposureCard, PerformanceCard } from "@/components/performance-exposure-cards";
import { getAllocation, getFireProgress } from "@/lib/goals.functions";
import { DashboardHero, DashboardHeroSkeleton } from "@/components/dashboard-hero";
import { heroSeries, periodChange } from "@/lib/dashboard-period";
import { listAssets, listDividends, listTransactions } from "@/lib/portfolio.functions";
import { getExposure } from "@/lib/exposure.functions";
import { updateAllPrices } from "@/lib/prices.functions";

import { dismissDataQualityAlerts, getDataQualityAlerts } from "@/lib/data-quality.functions";
import { alertKey, type DataQualityAlert } from "@/lib/data-quality";
import { cn } from "@/lib/utils";
import { type Asset, isOpenPosition } from "@/lib/portfolio-types";
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
  formatDatePt,
  formatDayLongPt,
  formatEUR,
  formatTimePt,
  sectorNamePt,
} from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { Badge, Button, EmptyState, ErrorState, Modal, PageHeader } from "@/components/ui-bits";

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

/** Cotações com mais de 3 dias consideram-se desatualizadas. */
const STALE_PRICE_DAYS = 3;

function AlertList({
  alerts,
  onDismiss,
}: {
  alerts: DataQualityAlert[];
  onDismiss: (a: DataQualityAlert) => void;
}) {
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
          <p className="min-w-0 flex-1 text-sm">{a.message}</p>
          <button
            type="button"
            onClick={() => onDismiss(a)}
            aria-label="Dispensar aviso"
            title="Dispensar aviso"
            className="-m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
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
  onDismiss,
  onDismissAll,
}: {
  alerts: DataQualityAlert[];
  onDismiss: (a: DataQualityAlert) => void;
  onDismissAll: () => void;
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
        <button
          type="button"
          onClick={onDismissAll}
          className="hidden shrink-0 rounded-md px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground md:inline-flex"
        >
          Limpar
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
          <AlertList alerts={alerts} onDismiss={onDismiss} />
        </div>
      )}
      <Modal open={modalOpen} onClose={() => onModalOpenChange(false)} title={title}>
        <div className="flex justify-end pb-1">
          <button
            type="button"
            onClick={() => {
              onDismissAll();
              onModalOpenChange(false);
            }}
            className="min-h-11 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Limpar todos
          </button>
        </div>
        <AlertList alerts={alerts} onDismiss={onDismiss} />
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
  const fetchAllocation = useServerFn(getAllocation);
  const refreshFn = useServerFn(updateAllPrices);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("ytd");
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);
  const dismissFn = useServerFn(dismissDataQualityAlerts);
  const dismissAlerts = async (list: DataQualityAlert[]) => {
    if (list.length === 0) return;
    // Otimista: esconde já; a query volta a ser lida do servidor a seguir.
    queryClient.setQueryData(["data-quality"], (old: { alerts: DataQualityAlert[] } | undefined) =>
      old ? { ...old, alerts: old.alerts.filter((a) => !list.includes(a)) } : old,
    );
    try {
      await dismissFn({ data: { keys: list.map(alertKey) } });
    } catch {
      toast.error("Não foi possível dispensar o aviso.");
    }
    await queryClient.invalidateQueries({ queryKey: ["data-quality"] });
  };

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
      await queryClient.invalidateQueries({ queryKey: ["allocation"] });
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
  const { data: allocationData } = useQuery({
    queryKey: ["allocation", "class", 0],
    queryFn: () => fetchAllocation({ data: { scope: "class", contribution: 0 } }),
  });
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
  const drifts = useMemo(() => {
    const d = allocationData?.drift;
    if (!d || d.targetSum <= 0) return null;
    return new Map(d.rows.map((r) => [r.key, r.driftPct] as const));
  }, [allocationData]);
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
      className="min-h-11 sm:min-h-[34px] sm:py-1"
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
    <div className="space-y-4 md:space-y-5">
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
          onDismiss={(a) => void dismissAlerts([a])}
          onDismissAll={() => void dismissAlerts(alerts)}
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

      <div className="grid gap-4 md:gap-5 lg:grid-cols-[7fr_5fr]">
        <AllocationCard allocation={allocation} drifts={drifts} hidden={hidden} />
        <FireCard progress={fireProgress} hidden={hidden} />
      </div>

      <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
        <PerformanceCard best={best} worst={worst} hidden={hidden} />
        <ExposureCard
          countries={exposure?.report.country
            .map((s) => ({ label: countryNamePt(s.value), pct: s.pct }))
            .slice(0, 5)}
          sectors={exposure?.report.sector
            .map((s) => ({ label: sectorNamePt(s.value), pct: s.pct }))
            .slice(0, 5)}
          companies={exposure?.report.companies
            .map((s) => ({ label: s.name, pct: s.pct }))
            .slice(0, 5)}
          hidden={hidden}
        />
      </div>
    </div>
  );
}
