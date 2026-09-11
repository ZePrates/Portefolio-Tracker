import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Target, Info } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { listAssets } from "@/lib/portfolio.functions";
import { assetCurrentValue, type Asset } from "@/lib/portfolio-types";
import {
  DEFAULT_SCENARIOS,
  PROJECTION_HORIZONS,
  projectPortfolio,
  goalProjection,
} from "@/lib/projections";
import { formatEUR } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { MetricCard, PageHeader } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/projecoes")({
  head: () => ({
    meta: [
      { title: "Projeções — Portefólio Tracker" },
      {
        name: "description",
        content: "Simulações de crescimento futuro do portefólio com diferentes cenários.",
      },
    ],
  }),
  component: ProjecoesPage,
});

const numberValue = (value: string) => {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

function ProjecoesPage() {
  const { hidden } = usePrivateMode();
  const fetchAssets = useServerFn(listAssets);
  const { data: assetsRaw, isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetchAssets(),
  });
  const assets = (assetsRaw ?? []) as Asset[];
  const currentValue = useMemo(
    () => assets.reduce((sum, asset) => sum + assetCurrentValue(asset), 0),
    [assets],
  );

  const [monthlyContribution, setMonthlyContribution] = useState(500);
  const [horizon, setHorizon] = useState<number>(10);
  const [target, setTarget] = useState(50000);
  const [returns, setReturns] = useState<Record<string, number>>(
    Object.fromEntries(DEFAULT_SCENARIOS.map((s) => [s.key, s.annualReturnPct])),
  );

  const simulations = DEFAULT_SCENARIOS.map((scenario) => {
    const annualReturnPct = returns[scenario.key] ?? scenario.annualReturnPct;
    return {
      ...scenario,
      annualReturnPct,
      projection: projectPortfolio({
        currentValue,
        monthlyContribution,
        annualReturnPct,
        years: horizon,
      }),
      goal: goalProjection(
        { currentValue, monthlyContribution, annualReturnPct, maxYears: 30 },
        target,
      ),
    };
  });

  const chartData =
    simulations[0]?.projection.points.map((point, index) => ({
      month: point.month,
      date: point.date,
      conservador: simulations[0]?.projection.points[index]?.value ?? 0,
      base: simulations[1]?.projection.points[index]?.value ?? 0,
      optimista: simulations[2]?.projection.points[index]?.value ?? 0,
    })) ?? [];

  const selectedBase = simulations[1];

  if (isLoading)
    return <div className="text-sm text-muted-foreground">A carregar os dados da carteira…</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projeções"
        subtitle="Simulações futuras com base no valor atual da carteira e nos pressupostos que definires."
      />

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-5 text-muted-foreground">
            Estas projeções são{" "}
            <strong className="text-foreground">simulações, não previsões garantidas</strong>. O
            valor atual é real; os valores futuros dependem exclusivamente dos pressupostos abaixo e
            não alteram os dados da carteira.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Aporte mensal (€)</span>
            <input
              type="number"
              min="0"
              step="10"
              value={monthlyContribution}
              onChange={(e) => setMonthlyContribution(Math.max(0, numberValue(e.target.value)))}
              className="h-10 w-full rounded-lg border border-input bg-background px-3"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Horizonte</span>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="h-10 w-full rounded-lg border border-input bg-background px-3"
            >
              {PROJECTION_HORIZONS.map((years) => (
                <option key={years} value={years}>
                  {years} {years === 1 ? "ano" : "anos"}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Objetivo (€)</span>
            <input
              type="number"
              min="0"
              step="1000"
              value={target}
              onChange={(e) => setTarget(Math.max(0, numberValue(e.target.value)))}
              className="h-10 w-full rounded-lg border border-input bg-background px-3"
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard label="Valor atual (real)" value={formatEUR(currentValue, hidden)} />
        <MetricCard
          label="Aporte mensal (simulação)"
          value={formatEUR(monthlyContribution, hidden)}
        />
        <MetricCard
          label={`Valor Base em ${horizon} anos`}
          value={formatEUR(selectedBase?.projection.final.value ?? 0, hidden)}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Crescimento projetado</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Capitalização mensal; o aporte é considerado no fim de cada mês.
            </p>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Conservador · {returns["conservative"]}%</span>
            <span>Base · {returns["base"]}%</span>
            <span>Optimista · {returns["optimistic"]}%</span>
          </div>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                tickFormatter={(m: number) =>
                  `${Math.floor(m / 12)}a${m % 12 ? ` ${m % 12}m` : ""}`
                }
              />
              <YAxis
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                tickFormatter={(v: number) => (hidden ? "••" : `${Math.round(v / 1000)}k`)}
              />
              <Tooltip
                formatter={(value: number) => [formatEUR(value, hidden), "Valor projetado"]}
                labelFormatter={(m) => `Mês ${m}`}
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.5rem",
                  fontSize: "0.8rem",
                }}
              />
              <Line
                type="monotone"
                dataKey="conservador"
                stroke="var(--color-chart-3)"
                strokeWidth={2}
                dot={false}
                name="Conservador"
              />
              <Line
                type="monotone"
                dataKey="base"
                stroke="var(--color-chart-1)"
                strokeWidth={3}
                dot={false}
                name="Base"
              />
              <Line
                type="monotone"
                dataKey="optimista"
                stroke="var(--color-chart-2)"
                strokeWidth={2}
                dot={false}
                name="Optimista"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {simulations.map((scenario) => (
          <div key={scenario.key} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{scenario.label}</h2>
              <span className="text-xs text-muted-foreground">
                {scenario.annualReturnPct}% / ano
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Valor final</p>
                <p className="mt-1 font-semibold">
                  {formatEUR(scenario.projection.final.value, hidden)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Capital aportado</p>
                <p className="mt-1 font-semibold">
                  {formatEUR(scenario.projection.final.invested, hidden)}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Ganhos projetados</p>
                <p
                  className={cn(
                    "mt-1 font-semibold",
                    scenario.projection.final.gains >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {formatEUR(scenario.projection.final.gains, hidden)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Target className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Objetivo</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Primeiro momento em que a simulação atinge {formatEUR(target, hidden)}. O cálculo
          considera até 30 anos.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {simulations.map((scenario) => (
            <div key={scenario.key} className="rounded-lg border border-border/60 p-4">
              <p className="text-sm font-medium">{scenario.label}</p>
              <p className="mt-2 text-sm">
                {scenario.goal.reached
                  ? `Atingido no mês ${scenario.goal.month} (ano ${scenario.goal.year})`
                  : "Não atingido em 30 anos"}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Pressupostos dos cenários</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {DEFAULT_SCENARIOS.map((scenario) => (
            <label key={scenario.key} className="space-y-1.5 text-sm">
              <span className="font-medium">{scenario.label} — retorno anual (%)</span>
              <input
                type="number"
                step="0.5"
                value={returns[scenario.key]}
                onChange={(e) =>
                  setReturns((current) => ({
                    ...current,
                    [scenario.key]: numberValue(e.target.value),
                  }))
                }
                className="h-10 w-full rounded-lg border border-input bg-background px-3"
              />
            </label>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Os valores editados servem apenas para esta simulação e não modificam o portefólio real.
        </p>
      </div>
    </div>
  );
}
