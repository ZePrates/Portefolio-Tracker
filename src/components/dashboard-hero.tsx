import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import type { PeriodKey, PortfolioSummary } from "@/lib/dashboard";
import type { HeroPoint, PeriodChange } from "@/lib/dashboard-period";
import {
  formatDatePt,
  formatEUR,
  formatEURCompact,
  formatPercent,
  formatPeriodKey,
  formatSignedEUR,
} from "@/lib/format";
import { AXIS_LINE, AXIS_TICK, ChartFrame, ChartTooltip, GRID_PROPS } from "@/components/chart-kit";
import { Skeleton } from "@/components/ui/skeleton";

const COMPACT_MARGIN = { top: 4, right: 0, bottom: 0, left: 0 };
const DEFAULT_MARGIN = { top: 5, right: 5, bottom: 5, left: 5 };

const HERO_PERIODS: PeriodKey[] = ["today", "month", "ytd", "1y", "all"];

const HERO_LABELS: Partial<Record<PeriodKey, string>> = {
  today: "Hoje",
  month: "Mês",
  ytd: "Ano",
  "1y": "1 ano",
  all: "Tudo",
};

const SINCE_LABELS: Partial<Record<PeriodKey, string>> = {
  today: "hoje",
  month: "este mês",
  ytd: "este ano",
  "1y": "nos últimos 12 meses",
  all: "desde o início",
};

/** Seletor segmentado (um botão por opção, `aria-pressed`); o ativo é neutro, não dourado. */
export function PeriodSelector({
  period,
  onChange,
  className,
}: {
  period: PeriodKey;
  onChange: (p: PeriodKey) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Período"
      className={cn("flex gap-0.5 rounded-[9px] bg-background p-[3px]", className)}
    >
      {HERO_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={period === p}
          onClick={() => onChange(p)}
          className={cn(
            "min-h-11 flex-1 rounded-md px-[11px] py-[9px] text-[12.5px] font-medium transition-colors duration-150 ease-out lg:min-h-0 lg:flex-none lg:py-[5px]",
            period === p
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {HERO_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

function Metric({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className="num mt-0.5 break-words text-[15px] font-medium">{children}</dd>
    </div>
  );
}

function LegendLine({ dashed, label }: { dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <svg aria-hidden width="18" height="4" className="shrink-0">
        <line
          x1="0"
          y1="2"
          x2="18"
          y2="2"
          stroke={dashed ? "var(--color-muted-foreground)" : "var(--color-foreground)"}
          strokeWidth={dashed ? 1.5 : 2}
          strokeDasharray={dashed ? "4 4" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

export function DashboardHero({
  period,
  onPeriodChange,
  summary,
  change,
  rangeFrom,
  realizedPeriod,
  series,
  hidden,
}: {
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
  summary: PortfolioSummary;
  change: PeriodChange | null;
  /** Início do período (para dizer "desde …" quando o histórico é mais curto). */
  rangeFrom: string;
  realizedPeriod: number;
  series: HeroPoint[];
  hidden: boolean;
}) {
  const gradientId = useId();
  const compact = useIsMobile();

  const partial = change?.baselineDate && change.baselineDate > rangeFrom;
  const sinceLabel = partial
    ? `desde ${formatDatePt(change?.baselineDate)}`
    : (SINCE_LABELS[period] ?? "");
  const up = (change?.amount ?? 0) >= 0;
  const PillIcon = up ? ArrowUpRight : ArrowDownRight;
  const tone = up ? "success" : "destructive";

  const chart = (
    <ChartFrame
      label={`Valor de mercado e capital investido, ${series.length} fotografias diárias`}
      height={compact ? 110 : 250}
      empty={series.length < 2}
      emptyLabel="Sem histórico suficiente; as fotografias diárias enchem com o tempo."
    >
      <AreaChart data={series} margin={compact ? COMPACT_MARGIN : DEFAULT_MARGIN}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-foreground)" stopOpacity={0.14} />
            <stop offset="100%" stopColor="var(--color-foreground)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {!compact && <CartesianGrid {...GRID_PROPS} />}
        <XAxis
          dataKey="date"
          hide={compact}
          tick={{ ...AXIS_TICK, fontSize: 11.5 }}
          axisLine={AXIS_LINE}
          tickLine={false}
          tickFormatter={(k: string) => formatPeriodKey(k)}
          minTickGap={32}
        />
        <YAxis
          hide={compact}
          orientation="right"
          domain={["auto", "auto"]}
          tick={{ ...AXIS_TICK, fontSize: 11.5 }}
          axisLine={false}
          tickLine={false}
          width={64}
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
          stroke="var(--color-muted-foreground)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          fill="none"
          dot={false}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="marketValue"
          name="Valor de mercado"
          stroke="var(--color-foreground)"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartFrame>
  );

  return (
    <section
      aria-label="Valor da carteira"
      className="grid min-w-0 overflow-hidden rounded-[14px] border border-foreground/[0.11] bg-card shadow-[0_1px_0_rgb(255_255_255/4%)_inset,0_12px_32px_-16px_rgb(0_0_0/60%)] lg:grid-cols-[380px_1fr]"
    >
      <div className="min-w-0 p-5 lg:border-r lg:border-border lg:px-7 lg:py-6">
        <PeriodSelector period={period} onChange={onPeriodChange} className="lg:inline-flex" />

        <p className="mt-5 text-[13px] text-muted-foreground">Valor da carteira</p>
        <p className="num mt-1 break-words text-4xl font-semibold leading-[42px] tracking-[-0.02em] lg:text-[44px] lg:leading-[48px]">
          {formatEUR(summary.currentValue, hidden)}
        </p>

        <div className="mt-3 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
          {change ? (
            <>
              <span
                className={cn(
                  "num text-[15px] font-semibold",
                  up ? "text-success" : "text-destructive",
                )}
              >
                {formatSignedEUR(change.amount, hidden)}
              </span>
              {change.pct !== null && (
                <span
                  className={cn(
                    "num inline-flex items-center gap-0.5 rounded-full px-[7px] py-0.5 text-[12.5px] font-semibold",
                    tone === "success"
                      ? "bg-success/[0.14] text-success"
                      : "bg-destructive/[0.14] text-destructive",
                  )}
                >
                  <PillIcon aria-hidden className="h-3 w-3" />
                  <span className="sr-only">{up ? "Subida de " : "Descida de "}</span>
                  {formatPercent(change.pct, hidden)}
                </span>
              )}
              <span className="text-[13px] text-muted-foreground">{sinceLabel}</span>
            </>
          ) : (
            <span className="text-[13px] text-muted-foreground">
              Sem histórico para calcular a variação neste período.
            </span>
          )}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-[18px] max-lg:rounded-lg max-lg:border max-lg:gap-0 max-lg:p-0 max-lg:[&>div]:p-3 max-lg:[&>div:nth-child(-n+2)]:border-b max-lg:[&>div:nth-child(odd)]:border-r max-lg:[&>div]:border-border">
          <Metric label="Capital investido">{formatEUR(summary.costBasis, hidden)}</Metric>
          <Metric label="Não realizado">
            <span className={summary.unrealizedPL < 0 ? "text-destructive" : "text-success"}>
              {formatSignedEUR(summary.unrealizedPL, hidden)}
            </span>
          </Metric>
          <Metric label="Realizado">
            <span className="sr-only">no período: </span>
            {formatSignedEUR(realizedPeriod, hidden)}
          </Metric>
          <Metric label="Rentabilidade total">
            {summary.totalReturnPct === null
              ? "Sem dados"
              : formatPercent(summary.totalReturnPct, hidden)}
          </Metric>
        </dl>
      </div>

      <div className="min-w-0 px-3 pb-3 lg:px-6 lg:pb-4 lg:pt-5">
        <div className="hidden flex-wrap items-center gap-x-5 gap-y-1 pb-3 lg:flex">
          <LegendLine label="Valor de mercado" />
          <LegendLine dashed label="Capital investido" />
          <span className="ml-auto text-[12.5px] text-muted-foreground">fotografias diárias</span>
        </div>
        {chart}
      </div>
    </section>
  );
}

export function DashboardHeroSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="A carregar"
      className="grid overflow-hidden rounded-[14px] border border-border bg-card lg:grid-cols-[380px_1fr]"
    >
      <div className="space-y-4 p-5 lg:border-r lg:border-border lg:px-7 lg:py-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-12 w-56" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="p-3 lg:p-6">
        <Skeleton className="h-[110px] w-full lg:h-[250px]" />
      </div>
    </div>
  );
}
