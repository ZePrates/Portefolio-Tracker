import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAssets } from "@/lib/portfolio.functions";
import { getExposure } from "@/lib/exposure.functions";
import { portfolioIntelligence } from "@/lib/intelligence";
import type { ExposureReport } from "@/lib/exposure";
import type { Asset } from "@/lib/portfolio-types";
import { PageHeader, MetricCard } from "@/components/ui-bits";
import { usePrivateMode } from "@/components/private-mode";
export const Route = createFileRoute("/_authenticated/inteligencia")({ component: Inteligencia });
function Inteligencia() {
  const fetch = useServerFn(listAssets),
    fetchExposure = useServerFn(getExposure);
  const { data } = useQuery({ queryKey: ["assets"], queryFn: () => fetch() });
  const { data: ex } = useQuery({ queryKey: ["exposure"], queryFn: () => fetchExposure() });
  const { hidden } = usePrivateMode();
  const assets = (data ?? []) as Asset[];
  const report = (ex as { report?: ExposureReport } | undefined)?.report;
  const intel = portfolioIntelligence(assets, report);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Inteligência da Carteira"
        subtitle="Risco, concentração e recomendações calculados a partir dos dados existentes."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Score" value={hidden ? "•••" : `${intel.score.toFixed(0)}/100`} />
        <MetricCard
          label="Maior posição"
          value={hidden ? "•••" : `${intel.metrics.largestAsset.toFixed(1)}%`}
        />
        <MetricCard label="Top 5" value={hidden ? "•••" : `${intel.metrics.top5.toFixed(1)}%`} />
        <MetricCard
          label="Maior classe"
          value={hidden ? "•••" : `${intel.metrics.largestClass.toFixed(1)}%`}
        />
        <MetricCard
          label="Cobertura exposição"
          value={hidden ? "•••" : report ? `${intel.metrics.coverage.toFixed(1)}%` : "N/D"}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Riscos identificados</h2>
          {intel.risks.length ? (
            <ul className="space-y-2 text-sm">
              {intel.risks.map((r) => (
                <li key={r} className="rounded-lg border border-border/60 p-3">
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem riscos materiais pelos limites definidos.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Recomendações</h2>
          <ul className="space-y-2 text-sm">
            {intel.recommendations.map((r) => (
              <li key={r} className="rounded-lg border border-border/60 p-3">
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {report && intel.metrics.coverage < 99 ? (
          <>
            ⚠️ A cobertura dos dados de exposição é de{" "}
            <strong>{intel.metrics.coverage.toFixed(1)}%</strong>. As métricas de concentração
            económica e as recomendações podem estar incompletas. Atualize os dados de exposição
            para aumentar a confiança da análise.
          </>
        ) : (
          <>A cobertura dos dados de exposição está adequada para esta análise.</>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        As recomendações são indicadores quantitativos, não aconselhamento financeiro personalizado.
      </p>
    </div>
  );
}
