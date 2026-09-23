import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAssets } from "@/lib/portfolio.functions";
import { getExposure } from "@/lib/exposure.functions";
import { portfolioIntelligence } from "@/lib/intelligence";
import type { ExposureReport } from "@/lib/exposure";
import type { PositionInput } from "@/lib/exposure-types";
import type { Asset, AssetClass } from "@/lib/portfolio-types";
import { CLASS_LABELS } from "@/lib/portfolio-types";
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
  const exResult = ex as { report?: ExposureReport; positions?: PositionInput[] } | undefined;
  const report = exResult?.report;
  const positions = exResult?.positions;
  const intel = portfolioIntelligence(assets, report, positions);
  const pct = (v: number) => (hidden ? "•••" : `${v.toFixed(1)}%`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inteligência da Carteira"
        subtitle="Concentração calculada com look-through: o peso de cada empresa dentro dos ETFs conta para a exposição real, não só o rótulo do instrumento."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Score" value={hidden ? "•••" : `${intel.score.toFixed(0)}/100`} />
        <MetricCard
          label="Maior empresa (look-through)"
          value={pct(intel.metrics.largestCompany)}
        />
        <MetricCard label="Top 5 empresas" value={pct(intel.metrics.top5Companies)} />
        <MetricCard
          label="Composição de ETF desconhecida"
          value={positions ? pct(intel.metrics.unknownLookThrough) : "N/D"}
        />
        <MetricCard
          label="Cobertura exposição"
          value={hidden ? "•••" : report ? pct(intel.metrics.coverage) : "N/D"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Maiores exposições por empresa</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Soma a posição direta com o peso da mesma empresa dentro de cada ETF que a contenha.
          </p>
          {intel.topCompanies.length ? (
            <ul className="space-y-2 text-sm">
              {intel.topCompanies.map((c) => (
                <li
                  key={c.label}
                  className="flex items-center justify-between rounded-lg border border-border/60 p-3"
                >
                  <span>{c.label}</span>
                  <span className="font-medium">{pct(c.weight * 100)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {positions
                ? "Sem exposições calculáveis."
                : "Sincroniza a composição dos ETFs (página Exposição) para ver esta análise ao nível da empresa."}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Perfil de alocação por instrumento</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Informativo — não é tratado como risco de concentração. Um ETF é, por natureza, já
            diversificado por dentro.
          </p>
          <ul className="space-y-2 text-sm">
            {intel.instrumentMix.map((m) => (
              <li
                key={m.class}
                className="flex items-center justify-between rounded-lg border border-border/60 p-3"
              >
                <span>{CLASS_LABELS[m.class as AssetClass] ?? m.class}</span>
                <span className="font-medium">{pct(m.weight * 100)}</span>
              </li>
            ))}
          </ul>
        </div>
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
        A correspondência entre uma posição direta e a mesma empresa dentro de um ETF é feita por
        nome (aproximada) — pode não apanhar todas as coincidências. As recomendações são
        indicadores quantitativos, não aconselhamento financeiro personalizado.
      </p>
    </div>
  );
}
