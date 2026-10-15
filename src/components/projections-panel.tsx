import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Info, Target } from "lucide-react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { listAssets } from "@/lib/portfolio.functions";
import { getFireProgress } from "@/lib/goals.functions";
import { assetCurrentValue, type Asset } from "@/lib/portfolio-types";
import {
  DEFAULT_SCENARIOS,
  PROJECTION_HORIZONS,
  goalProjection,
  projectPortfolio,
} from "@/lib/projections";
import { formatEURCompact, formatNumber, formatPct, parseNumberOr } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import {
  Button,
  Card,
  ErrorState,
  Field,
  KpiGridSkeleton,
  MetricCard,
  SelectInput,
  TextInput,
} from "@/components/ui-bits";
import { AXIS_LINE, AXIS_TICK, ChartFrame, ChartTooltip, GRID_PROPS } from "@/components/chart-kit";
import { cn } from "@/lib/utils";
import { privateEUR } from "@/components/private-value";

/** Diferença, em pontos percentuais, entre o cenário base e os outros dois. */
const SPREAD = 3;

interface ProjectionForm {
  monthly: string;
  horizon: number;
  target: string;
  returns: Record<string, string>;
}

interface FireData {
  settings: { monthlyContribution: number; expectedReturnPct: number } | null;
  progress: { fireNumber: number } | null;
}

const pt = (n: number, decimals = 0) => formatNumber(n, decimals).replace(/\s/g, "");

/** Valores iniciais: os do objetivo FIRE, quando existe; senão os de referência. */
function initialForm(fire: FireData | undefined): ProjectionForm {
  const base =
    fire?.settings?.expectedReturnPct ??
    DEFAULT_SCENARIOS.find((s) => s.key === "base")!.annualReturnPct;
  const returnOf = (key: string) =>
    key === "conservative"
      ? Math.max(0, base - SPREAD)
      : key === "optimistic"
        ? base + SPREAD
        : base;
  return {
    monthly: pt(fire?.settings?.monthlyContribution ?? 500),
    horizon: 10,
    target: pt(Math.round(fire?.progress?.fireNumber ?? 50_000)),
    returns: Object.fromEntries(DEFAULT_SCENARIOS.map((s) => [s.key, pt(returnOf(s.key), 1)])),
  };
}

/** Projeções da carteira (separador de Objetivos), ligadas ao objetivo FIRE. */
export function ProjectionsPanel() {
  const { hidden } = usePrivateMode();
  const fetchAssets = useServerFn(listAssets);
  const fetchFire = useServerFn(getFireProgress);
  const assetsQ = useQuery({ queryKey: ["assets"], queryFn: () => fetchAssets() });
  const fireQ = useQuery({ queryKey: ["fire"], queryFn: () => fetchFire() });
  const fire = fireQ.data as FireData | undefined;

  const currentValue = useMemo(
    () => ((assetsQ.data ?? []) as Asset[]).reduce((sum, a) => sum + assetCurrentValue(a), 0),
    [assetsQ.data],
  );

  const [form, setForm] = useState<ProjectionForm | null>(null);
  useEffect(() => {
    if (form === null && !fireQ.isLoading) setForm(initialForm(fire));
  }, [form, fireQ.isLoading, fire]);

  if (assetsQ.isError) return <ErrorState onRetry={() => void assetsQ.refetch()} />;
  if (assetsQ.isLoading || form === null) return <KpiGridSkeleton count={3} />;

  const monthlyContribution = Math.max(0, parseNumberOr(form.monthly, 0));
  const target = Math.max(0, parseNumberOr(form.target, 0));
  const fromFire = !!fire?.settings;

  const simulations = DEFAULT_SCENARIOS.map((scenario) => {
    const annualReturnPct = parseNumberOr(form.returns[scenario.key] ?? "", 0);
    return {
      ...scenario,
      annualReturnPct,
      projection: projectPortfolio({
        currentValue,
        monthlyContribution,
        annualReturnPct,
        years: form.horizon,
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
      conservador: simulations[0]?.projection.points[index]?.value ?? 0,
      base: simulations[1]?.projection.points[index]?.value ?? 0,
      optimista: simulations[2]?.projection.points[index]?.value ?? 0,
    })) ?? [];
  const selectedBase = simulations[1];

  // Modo privado: os montantes ficam mascarados (o campo continua editável).
  const moneyMask = hidden ? "[-webkit-text-security:disc]" : undefined;

  const set = (key: "monthly" | "target") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  return (
    <>
      <Card>
        <div className="mb-4 flex items-start gap-3">
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-5 text-muted-foreground">
            Estas projeções são{" "}
            <strong className="text-foreground">simulações, não previsões garantidas</strong>. O
            valor atual é real; os valores futuros dependem dos pressupostos abaixo e não alteram a
            carteira.{" "}
            {fromFire
              ? "Os valores iniciais vêm do teu objetivo FIRE (aporte, retorno esperado e número FIRE)."
              : "Define o objetivo FIRE no separador FIRE para partires dos teus valores."}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Aporte mensal (€)">
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              value={form.monthly}
              onChange={set("monthly")}
              className={moneyMask}
            />
          </Field>
          <Field label="Horizonte">
            <SelectInput
              value={form.horizon}
              onChange={(e) => setForm((f) => (f ? { ...f, horizon: Number(e.target.value) } : f))}
            >
              {PROJECTION_HORIZONS.map((years) => (
                <option key={years} value={years}>
                  {years} {years === 1 ? "ano" : "anos"}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={fromFire ? "Objetivo (€) — número FIRE" : "Objetivo (€)"}>
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              value={form.target}
              onChange={set("target")}
              className={moneyMask}
            />
          </Field>
        </div>
        {fromFire && (
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={() => setForm(initialForm(fire))}>
              Repor os valores do FIRE
            </Button>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard label="Valor atual (real)" value={privateEUR(currentValue, hidden)} />
        <MetricCard
          label="Aporte mensal (simulação)"
          value={privateEUR(monthlyContribution, hidden)}
        />
        <MetricCard
          label={`Valor base em ${form.horizon} ${form.horizon === 1 ? "ano" : "anos"}`}
          value={privateEUR(selectedBase?.projection.final.value ?? 0, hidden)}
        />
      </div>

      <Card
        title="Crescimento projetado"
        description="Capitalização mensal; o aporte é considerado no fim de cada mês."
        action={
          <span className="flex gap-3 text-muted-foreground">
            {simulations.map((s) => (
              <span key={s.key}>
                {s.label} · {formatPct(s.annualReturnPct, 1)}
              </span>
            ))}
          </span>
        }
      >
        <ChartFrame
          label="Crescimento projetado da carteira nos cenários conservador, base e optimista"
          height={320}
        >
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey="month"
              tick={AXIS_TICK}
              axisLine={AXIS_LINE}
              tickLine={false}
              tickFormatter={(m: number) => `${Math.floor(m / 12)}a${m % 12 ? ` ${m % 12}m` : ""}`}
            />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={56}
              tickFormatter={(v: number) => (hidden ? "•" : formatEURCompact(v))}
            />
            <Tooltip
              content={
                <ChartTooltip
                  labelFormatter={(m) => {
                    const n = Number(m);
                    return `${Math.floor(n / 12)} anos${n % 12 ? ` e ${n % 12} meses` : ""}`;
                  }}
                  valueFormatter={(v) => privateEUR(v, hidden)}
                />
              }
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
        </ChartFrame>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {simulations.map((scenario) => (
          <Card
            key={scenario.key}
            title={scenario.label}
            action={
              <span className="text-muted-foreground">
                {formatPct(scenario.annualReturnPct, 1)} / ano
              </span>
            }
          >
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted-foreground">Valor final</dt>
                <dd className="num mt-1 font-semibold">
                  {privateEUR(scenario.projection.final.value, hidden)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Capital aportado</dt>
                <dd className="num mt-1 font-semibold">
                  {privateEUR(scenario.projection.final.invested, hidden)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Ganhos projetados</dt>
                <dd
                  className={cn(
                    "num mt-1 font-semibold",
                    scenario.projection.final.gains >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {privateEUR(scenario.projection.final.gains, hidden)}
                </dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>

      <Card
        title="Objetivo"
        icon={<Target aria-hidden className="h-4 w-4 text-primary" />}
        description={
          <>
            Primeiro momento em que a simulação atinge {privateEUR(target, hidden)}. O cálculo
            considera até 30 anos.
          </>
        }
      >
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
      </Card>

      <Card
        title="Pressupostos dos cenários"
        description="Os valores editados servem só para esta simulação e não alteram a carteira nem o objetivo FIRE."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {DEFAULT_SCENARIOS.map((scenario) => (
            <Field key={scenario.key} label={`${scenario.label} — retorno anual (%)`}>
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={form.returns[scenario.key] ?? ""}
                onChange={(e) =>
                  setForm((f) =>
                    f ? { ...f, returns: { ...f.returns, [scenario.key]: e.target.value } } : f,
                  )
                }
              />
            </Field>
          ))}
        </div>
      </Card>
    </>
  );
}
