import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAssets } from "@/lib/portfolio.functions";
import { getExposure } from "@/lib/exposure.functions";
import { portfolioIntelligence } from "@/lib/intelligence";
import type { ExposureReport } from "@/lib/exposure";
import type { PositionInput } from "@/lib/exposure-types";
import type { Asset, AssetClass } from "@/lib/portfolio-types";
import { CLASS_LABELS, isOpenPosition } from "@/lib/portfolio-types";
import { Plus, TriangleAlert } from "lucide-react";
import {
  Button,
  EmptyState,
  ErrorState,
  KpiGridSkeleton,
  MetricCard,
  PageHeader,
} from "@/components/ui-bits";
import { usePrivateMode } from "@/components/private-mode";
import { formatNumber, formatPct } from "@/lib/format";

const TITLE = "Inteligência";
const DESCRIPTION =
  "Concentração real da carteira: o peso de cada empresa dentro dos ETFs também conta, não só o tipo de instrumento.";

export const Route = createFileRoute("/_authenticated/inteligencia")({
  head: () => ({
    meta: [
      { title: `${TITLE} — Portefólio Tracker` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: `${TITLE} — Portefólio Tracker` },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: Inteligencia,
});

function Inteligencia() {
  const fetch = useServerFn(listAssets),
    fetchExposure = useServerFn(getExposure);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetch(),
  });
  const { data: ex } = useQuery({ queryKey: ["exposure"], queryFn: () => fetchExposure() });
  const { hidden } = usePrivateMode();
  const assets = (data ?? []) as Asset[];
  const exResult = ex as { report?: ExposureReport; positions?: PositionInput[] } | undefined;
  const report = exResult?.report;
  const positions = exResult?.positions;
  const intel = portfolioIntelligence(assets, report, positions);
  const pct = (v: number) => formatPct(v, 1, hidden);

  if (isError || isLoading || !assets.some(isOpenPosition)) {
    return (
      <div className="space-y-6">
        <PageHeader title={TITLE} subtitle={DESCRIPTION} />
        {isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : isLoading ? (
          <KpiGridSkeleton count={4} />
        ) : (
          <EmptyState
            title="Sem posições para analisar"
            description="Adiciona ativos à carteira para veres a concentração real."
            action={
              <Link to="/etfs">
                <Button>
                  <Plus aria-hidden className="h-4 w-4" />
                  Adicionar primeiro ativo
                </Button>
              </Link>
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={TITLE} subtitle={DESCRIPTION} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Pontuação"
          value={hidden ? "••••" : `${formatNumber(intel.score, 0)}/100`}
        />
        <MetricCard label="Maior empresa (com ETFs)" value={pct(intel.metrics.largestCompany)} />
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

      {report && intel.metrics.coverage < 99 ? (
        <div className="flex items-start gap-3 rounded-xl border border-warning/20 bg-warning/[0.08] p-4 text-sm text-muted-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            A cobertura dos dados de exposição é de{" "}
            <strong className="text-foreground">{formatPct(intel.metrics.coverage, 1)}</strong>. As
            métricas de concentração económica e as recomendações podem estar incompletas. Atualiza
            a composição dos ETFs na página Exposição para teres uma análise mais fiável.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          A cobertura dos dados de exposição está adequada para esta análise.
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        A correspondência entre uma posição direta e a mesma empresa dentro de um ETF é feita por
        nome (aproximada) — pode não apanhar todas as coincidências. As recomendações são
        indicadores quantitativos, não aconselhamento financeiro personalizado.
      </p>
    </div>
  );
}
