import { dateXAxis, formatChartTooltipDate } from "@/lib/chart-dates";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis, Legend } from "recharts";
import {
  SP500_ANNUAL_RETURN_PCT,
  type BenchmarkComparison,
  type BenchmarkScope,
} from "@/lib/benchmark";
import { formatEURCompact, formatNumber, formatPct } from "@/lib/format";
import { AXIS_LINE, AXIS_TICK, ChartFrame, ChartTooltip, GRID_PROPS } from "@/components/chart-kit";
import { Button, Card, EmptyState, MetricCard } from "@/components/ui-bits";
import { privateEUR } from "@/components/private-value";

/** Carteira vs. S&P 500 hipotético com os mesmos aportes, nas mesmas datas. */
export function BenchmarkCard({
  comparison,
  scope,
  onScopeChange,
  hidden,
}: {
  comparison: BenchmarkComparison | null;
  scope: BenchmarkScope;
  onScopeChange: (scope: BenchmarkScope) => void;
  hidden: boolean;
}) {
  const rate = formatNumber(comparison?.annualReturnPct ?? SP500_ANNUAL_RETURN_PCT, 2);
  return (
    <Card
      title={`Carteira vs. S&P 500 (${rate} %/ano)`}
      description={`Os mesmos aportes e vendas, nas mesmas datas, num S&P 500 que rendesse ${rate} % ao ano com dividendos reinvestidos. Desde o primeiro movimento, independentemente do período escolhido.`}
      action={
        <div className="flex gap-1">
          <Button
            variant={scope === "total" ? "primary" : "outline"}
            onClick={() => onScopeChange("total")}
          >
            Carteira toda
          </Button>
          <Button
            variant={scope === "etf" ? "primary" : "outline"}
            onClick={() => onScopeChange("etf")}
          >
            Só ETFs
          </Button>
        </div>
      }
    >
      {comparison ? (
        <BenchmarkBody c={comparison} rate={rate} hidden={hidden} />
      ) : (
        <EmptyState
          title="Sem movimentos"
          description="Não há compras registadas neste âmbito para comparar."
        />
      )}
    </Card>
  );
}

function BenchmarkBody({
  c,
  rate,
  hidden,
}: {
  c: BenchmarkComparison;
  rate: string;
  hidden: boolean;
}) {
  const ahead = c.difference >= 0;
  const chart = c.series.map((p) => ({
    date: p.date,
    [`S&P 500 a ${rate} %`]: Math.round(p.benchmark),
    "Capital investido": Math.round(p.invested),
    Carteira: p.portfolio == null ? null : Math.round(p.portfolio),
  }));
  const months = c.series.filter((p) => p.portfolio != null).length;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-4">
        <MetricCard
          label="Carteira"
          value={privateEUR(c.portfolio, hidden)}
          sub={<>valor atual + {privateEUR(c.dividends, hidden)} de dividendos recebidos</>}
        />
        <MetricCard
          label={`S&P 500 a ${rate} %`}
          value={privateEUR(c.benchmark, hidden)}
          sub={<>com {privateEUR(c.invested, hidden)} investidos</>}
        />
        <MetricCard
          label={ahead ? "À frente do S&P 500" : "Atrás do S&P 500"}
          value={
            <>
              {ahead ? "+" : ""}
              {privateEUR(c.difference, hidden)}
            </>
          }
          sub={c.differencePct == null ? "" : formatPct(c.differencePct, 1)}
          tone={ahead ? "positive" : "negative"}
        />
      </div>

      <ChartFrame
        label="Valor da carteira, do S&P 500 hipotético e capital investido, por mês"
        height={260}
        empty={chart.length < 2}
        emptyLabel="Histórico ainda curto para o gráfico."
        className="mt-5"
      >
        <LineChart data={chart}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis
            dataKey="date"
            tick={AXIS_TICK}
            axisLine={AXIS_LINE}
            tickLine={false}
            {...dateXAxis(chart.map((p) => p.date))}
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
                labelFormatter={formatChartTooltipDate}
                valueFormatter={(v) => privateEUR(v, hidden)}
              />
            }
          />
          <Legend />
          <Line
            type="monotone"
            dataKey={`S&P 500 a ${rate} %`}
            stroke="var(--color-chart-3)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="Carteira"
            stroke="var(--color-chart-2)"
            strokeWidth={2.5}
            dot={months < 6}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="Capital investido"
            stroke="var(--color-chart-1)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartFrame>
      <p className="mt-3 text-[12px] text-muted-foreground">
        A linha da carteira usa as fotografias guardadas pela app e o histórico importado de ETFs
        (valor + dividendos recebidos); nos meses sem fotografia não há ponto. Retorno fixo, sem
        volatilidade nem câmbio: serve para comparar com uma referência simples, não para dizer como
        o S&P 500 se comportou de facto. Só entram ativos com movimentos registados (ex.: P2P sem
        transações fica de fora).
      </p>
    </>
  );
}
