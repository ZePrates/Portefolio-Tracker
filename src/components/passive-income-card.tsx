import { Link } from "@tanstack/react-router";
import { Bar, BarChart, Cell, Tooltip, XAxis } from "recharts";
import { useMemo } from "react";
import type { ProjectedDividend } from "@/lib/dividend-calendar";
import { todayISO } from "@/lib/dashboard";
import {
  formatDayMonthPt,
  formatEUR,
  formatMonthPt,
  formatPct,
  formatPeriodKey,
} from "@/lib/format";
import { Card } from "@/components/ui-bits";
import { AXIS_LINE, AXIS_TICK, ChartFrame, ChartTooltip } from "@/components/chart-kit";

const MONTHS_SHOWN = 12;
const UPCOMING_SHOWN = 4;

/** Os últimos `count` meses (aaaa-mm) até ao mês de `today`, com 0 onde não houve pagamentos. */
function lastMonths(byMonth: Array<{ key: string; amount: number }>, today: string, count: number) {
  const amounts = new Map(byMonth.map((m) => [m.key, m.amount]));
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    keys.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return keys.map((key) => ({ key, amount: amounts.get(key) ?? 0 }));
}

function Metric({
  label,
  children,
  big,
}: {
  label: string;
  children: React.ReactNode;
  big?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd
        className={
          big
            ? "num mt-0.5 break-words text-2xl font-semibold leading-[30px]"
            : "num mt-0.5 break-words text-[15px] font-medium"
        }
      >
        {children}
      </dd>
    </div>
  );
}

export function PassiveIncomeCard({
  byMonth,
  last12,
  yieldOnCost,
  sinceStart,
  upcoming,
  hidden,
}: {
  byMonth: Array<{ key: string; amount: number }>;
  last12: number;
  yieldOnCost: number | null;
  sinceStart: number;
  /** Pagamentos projetados (estimativa); `undefined` enquanto carrega. */
  upcoming: ProjectedDividend[] | undefined;
  hidden: boolean;
}) {
  const today = todayISO();
  const months = useMemo(() => lastMonths(byMonth, today, MONTHS_SHOWN), [byMonth, today]);
  const next = useMemo(
    () =>
      (upcoming ?? [])
        .filter((e) => e.paymentDate >= today)
        .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))
        .slice(0, UPCOMING_SHOWN),
    [upcoming, today],
  );
  const hasHistory = byMonth.length > 0;

  return (
    <Card
      headingLevel={2}
      title="Rendimento passivo"
      action={
        <Link
          to="/dividendos"
          className="inline-flex min-h-6 items-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Dividendos →
        </Link>
      }
    >
      <div className="grid gap-7 lg:grid-cols-[200px_1fr_280px]">
        <dl className="hidden space-y-4 md:block">
          <Metric label="Últimos 12 meses" big>
            {formatEUR(last12, hidden)}
          </Metric>
          <Metric label="Yield sobre custo">
            {yieldOnCost === null ? "Sem dados" : formatPct(yieldOnCost, 1, hidden)}
          </Metric>
          <Metric label="Desde o início">{formatEUR(sinceStart, hidden)}</Metric>
        </dl>

        <div className="hidden min-w-0 md:block">
          <ChartFrame
            label={`Dividendos recebidos por mês, últimos ${MONTHS_SHOWN} meses`}
            height={150}
            empty={!hasHistory}
            emptyLabel="Ainda não há dividendos recebidos."
          >
            <BarChart data={months} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="key"
                tick={{ ...AXIS_TICK, fontSize: 11.5 }}
                axisLine={AXIS_LINE}
                tickLine={false}
                interval={0}
                tickFormatter={(k: string) => formatMonthPt(k).split("/")[0] ?? k}
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
                dataKey="amount"
                name="Dividendos"
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              >
                {months.map((m, i) => (
                  <Cell
                    key={m.key}
                    fill="var(--color-chart-2)"
                    fillOpacity={i === months.length - 1 ? 1 : 0.45}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartFrame>
        </div>

        <div className="min-w-0">
          <h3 className="mb-2 text-[13px] font-medium text-muted-foreground">
            Próximos dividendos <span className="font-normal">(estimativa)</span>
          </h3>
          {upcoming === undefined ? (
            <p className="py-3 text-[13px] text-muted-foreground">A carregar…</p>
          ) : next.length === 0 ? (
            <p className="py-3 text-[13px] text-muted-foreground">Sem pagamentos previstos.</p>
          ) : (
            <ul>
              {next.map((e) => (
                <li
                  key={`${e.assetId}-${e.paymentDate}`}
                  className="flex min-h-11 items-center gap-3 border-b border-foreground/5 py-1.5 last:border-b-0"
                >
                  <span className="num grid h-10 w-10 shrink-0 place-items-center rounded-md bg-foreground/5 text-[11.5px] font-medium">
                    {formatDayMonthPt(e.paymentDate)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px]" title={e.assetName}>
                    {e.assetName}
                  </span>
                  <span className="num shrink-0 text-[13.5px] font-medium">
                    {formatEUR(e.net, hidden)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
