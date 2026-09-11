import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { listAssets } from "@/lib/portfolio.functions";
import {
  type Asset,
  type AssetClass,
  CLASS_LABELS,
  assetCurrentValue,
  assetInvested,
  assetPL,
} from "@/lib/portfolio-types";
import { formatEUR, formatPercent } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { PageHeader, EmptyState, Button, MetricCard } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/analise")({
  head: () => ({
    meta: [
      { title: "Análise — Portefólio Tracker" },
      {
        name: "description",
        content: "Exposição, alocação e rentabilidade detalhadas do teu portefólio.",
      },
      { property: "og:title", content: "Análise — Portefólio Tracker" },
      {
        property: "og:description",
        content: "Exposição, alocação e rentabilidade detalhadas do teu portefólio.",
      },
    ],
  }),
  component: AnalisePage,
});

function AnalisePage() {
  const { hidden } = usePrivateMode();
  const fetchAssets = useServerFn(listAssets);
  const { data: assetsRaw, isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetchAssets(),
  });

  const assets = (assetsRaw ?? []) as Asset[];

  if (!isLoading && assets.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Análise" subtitle="Exposição, alocação e rentabilidade detalhadas." />
        <EmptyState
          title="Sem dados para analisar"
          description="Adicione ativos ao seu portefólio para ver a análise detalhada."
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

  const total = assets.reduce((s, a) => s + assetCurrentValue(a), 0);

  const byClass = (Object.keys(CLASS_LABELS) as AssetClass[]).map((c) => {
    const rows = assets.filter((a) => a.class === c);
    const invested = rows.reduce((s, a) => s + assetInvested(a), 0);
    const current = rows.reduce((s, a) => s + assetCurrentValue(a), 0);
    return {
      class: c,
      label: CLASS_LABELS[c],
      invested,
      current,
      pl: current - invested,
      pct: total > 0 ? (current / total) * 100 : 0,
      plPct: invested > 0 ? ((current - invested) / invested) * 100 : 0,
    };
  });

  const topPositions = [...assets]
    .sort((a, b) => assetCurrentValue(b) - assetCurrentValue(a))
    .slice(0, 8);
  const top3 = topPositions.slice(0, 3).reduce((s, a) => s + assetCurrentValue(a), 0);
  const concentration = total > 0 ? (top3 / total) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Análise" subtitle="Exposição, alocação e rentabilidade detalhadas." />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
        <MetricCard label="Valor total" value={formatEUR(total, hidden)} />
        <MetricCard
          label="Concentração (top 3)"
          value={hidden ? "••••" : `${concentration.toFixed(1).replace(".", ",")}%`}
          sub="Percentagem das 3 maiores posições"
        />
        <MetricCard label="Nº de posições" value={String(assets.length)} />
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Investido vs. valor atual por classe</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byClass} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => (hidden ? "••" : `${Math.round(v / 1000)}k`)}
              />
              <Tooltip
                formatter={(v: number, name: string) => [
                  formatEUR(v, hidden),
                  name === "invested" ? "Investido" : "Valor atual",
                ]}
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.5rem",
                  color: "var(--color-foreground)",
                  fontSize: "0.8rem",
                }}
              />
              <Bar dataKey="invested" fill="var(--color-chart-3)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="current" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">Rentabilidade por classe</h2>
          <ul className="space-y-2">
            {byClass.map((c) => (
              <li
                key={c.class}
                className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-2.5 text-sm"
              >
                <span className="font-medium">{c.label}</span>
                <span
                  className={cn(
                    "font-medium",
                    c.pl > 0
                      ? "text-success"
                      : c.pl < 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                >
                  {formatEUR(c.pl, hidden)}{" "}
                  <span className="text-xs">({formatPercent(c.plPct, hidden)})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">Maiores posições</h2>
          <ul className="space-y-2">
            {topPositions.map((a) => {
              const value = assetCurrentValue(a);
              const p = assetPL(a);
              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {CLASS_LABELS[a.class]}
                      {total > 0 && !hidden && ` · ${((value / total) * 100).toFixed(1)}%`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatEUR(value, hidden)}</p>
                    <p
                      className={cn(
                        "text-xs",
                        p.abs > 0
                          ? "text-success"
                          : p.abs < 0
                            ? "text-destructive"
                            : "text-muted-foreground",
                      )}
                    >
                      {formatPercent(p.pct, hidden)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
