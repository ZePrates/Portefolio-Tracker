import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays } from "lucide-react";
import {
  Badge,
  Card,
  ErrorState,
  KpiGridSkeleton,
  MetricCard,
  PageHeader,
} from "@/components/ui-bits";
import { DataTable, type Column } from "@/components/data-table";
import { AXIS_LINE, AXIS_TICK, ChartFrame, ChartTooltip, GRID_PROPS } from "@/components/chart-kit";
import { usePrivateMode } from "@/components/private-mode";
import { getDividendCalendar } from "@/lib/insights.functions";
import type { ProjectedDividend } from "@/lib/dividend-calendar";
import {
  formatCompact,
  formatDatePt,
  formatEUR,
  formatMoney,
  formatPeriodKey,
  formatQuantity,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário de dividendos — Portefólio Tracker" },
      {
        name: "description",
        content:
          "Projeção dos dividendos dos próximos meses, estimada a partir do histórico de pagamentos de cada ativo.",
      },
    ],
  }),
  component: CalendarioPage,
});

const HORIZONS = [6, 12, 24] as const;

function CalendarioPage() {
  const { hidden } = usePrivateMode();
  const fetchCalendar = useServerFn(getDividendCalendar);
  const [months, setMonths] = useState<(typeof HORIZONS)[number]>(12);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dividend-calendar", months],
    queryFn: () => fetchCalendar({ data: { months } }),
  });

  const columns: Column<ProjectedDividend>[] = [
    {
      id: "payment",
      header: "Pagamento",
      required: true,
      sortValue: (e) => e.paymentDate,
      cell: (e) => formatDatePt(e.paymentDate),
    },
    {
      id: "asset",
      header: "Ativo",
      required: true,
      sortValue: (e) => e.assetName.toLowerCase(),
      cell: (e) => <span className="font-medium">{e.assetName}</span>,
    },
    {
      id: "ex",
      header: "Ex-date",
      defaultHidden: true,
      sortValue: (e) => e.exDate,
      cell: (e) => formatDatePt(e.exDate),
    },
    {
      id: "qty",
      header: "Qtd.",
      align: "right",
      sortValue: (e) => e.quantity,
      cell: (e) => formatQuantity(e.quantity),
    },
    {
      id: "perShare",
      header: "Por ação",
      align: "right",
      defaultHidden: true,
      sortValue: (e) => e.perShareNative,
      cell: (e) => formatMoney(e.perShareNative, e.currency, hidden),
    },
    {
      id: "gross",
      header: "Bruto",
      align: "right",
      sortValue: (e) => e.gross,
      cell: (e) => formatEUR(e.gross, hidden),
    },
    {
      id: "net",
      header: "Líquido",
      align: "right",
      required: true,
      sortValue: (e) => e.net,
      cell: (e) => <span className="font-medium">{formatEUR(e.net, hidden)}</span>,
    },
  ];

  const card = (e: ProjectedDividend) => (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium leading-snug">{e.assetName}</p>
        <p className="text-xs text-muted-foreground">
          {formatDatePt(e.paymentDate)} · {formatQuantity(e.quantity)} un.
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="num font-semibold">{formatEUR(e.net, hidden)}</p>
        <p className="num text-xs text-muted-foreground">bruto {formatEUR(e.gross, hidden)}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendário de dividendos"
        subtitle="Projeção dos próximos pagamentos, estimada a partir do histórico de cada ativo e da retenção na fonte do país."
        actions={
          <div role="group" aria-label="Horizonte" className="flex gap-1.5">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={months === h}
                onClick={() => setMonths(h)}
                className={cn(
                  "min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  months === h
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {h} meses
              </button>
            ))}
          </div>
        }
      />

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <KpiGridSkeleton count={3} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
            <MetricCard
              label={`Líquido previsto (${months} meses)`}
              value={formatEUR(data.totalNet, hidden)}
              className="col-span-2 lg:col-span-1"
            />
            <MetricCard label="Bruto previsto" value={formatEUR(data.totalGross, hidden)} />
            <MetricCard label="Pagamentos previstos" value={String(data.events.length)} />
          </div>

          <Card
            title="Por mês"
            icon={<CalendarDays aria-hidden className="h-4 w-4 text-primary" />}
            description="Estimativa; os valores reais dependem das decisões de cada empresa."
          >
            <ChartFrame
              label={`Dividendos previstos por mês nos próximos ${months} meses`}
              empty={data.byMonth.length === 0}
              emptyLabel="Sem pagamentos projetados: faltam dividendos no histórico."
            >
              <BarChart data={data.byMonth}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis
                  dataKey="month"
                  tick={AXIS_TICK}
                  axisLine={AXIS_LINE}
                  tickLine={false}
                  tickFormatter={(k: string) => formatPeriodKey(k)}
                  minTickGap={12}
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
                      labelFormatter={(l) => formatPeriodKey(l)}
                      valueFormatter={(v) => formatEUR(v, hidden)}
                    />
                  }
                />
                <Bar
                  dataKey="net"
                  name="Líquido"
                  fill="var(--color-chart-2)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="gross"
                  name="Bruto"
                  fill="var(--color-chart-8)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartFrame>
          </Card>

          {data.events.length > 0 && (
            <section aria-labelledby="cal-lista" className="space-y-3">
              <h2 id="cal-lista" className="text-base font-semibold">
                Pagamentos previstos
              </h2>
              <DataTable
                rows={data.events}
                columns={columns}
                rowKey={(e) => `${e.assetId}-${e.exDate}-${e.paymentDate}`}
                caption="Pagamentos de dividendos previstos"
                storageKey="calendar"
                defaultSort={{ id: "payment", dir: "asc" }}
                searchText={(e) => e.assetName}
                searchPlaceholder="Pesquisar ativo…"
                pageSize={25}
                renderCard={card}
              />
            </section>
          )}

          {data.skipped.length > 0 && (
            <Card title="Fora da projeção" description="Ativos sem histórico suficiente.">
              <ul className="space-y-1.5 text-sm">
                {data.skipped.map((s) => (
                  <li key={s.assetId} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{s.assetName}</span>
                    <Badge className="shrink-0">{s.reason}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
