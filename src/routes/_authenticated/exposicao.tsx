import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleAlert, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getExposure, syncAllAssetExposure } from "@/lib/exposure.functions";
import type { CompanyExposure, Slice } from "@/lib/exposure-types";
import {
  exposureEUR,
  exposurePct,
  exposureSector,
  mergeDisplaySlices,
} from "@/lib/exposure-display";
import { syncManagerHoldings, syncSummaryText } from "@/lib/holdings-sync";
import { usePrivateMode } from "@/components/private-mode";
import {
  Button,
  EmptyState,
  ErrorState,
  KpiGridSkeleton,
  MetricCard,
  PageHeader,
} from "@/components/ui-bits";
import { ExposureBars } from "@/components/exposure-bars";
import { ExposureTable } from "@/components/exposure-table";
import { EtfCoverageTable } from "@/components/etf-coverage";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/exposicao")({
  head: () => ({
    meta: [
      { title: "Exposição e peso das empresas — Portefólio Tracker" },
      {
        name: "description",
        content:
          "Peso real das empresas, países e setores na carteira, com posições completas dos ETFs e cobertura das gestoras.",
      },
      { property: "og:title", content: "Exposição e peso das empresas — Portefólio Tracker" },
      {
        property: "og:description",
        content: "Exposição direta e via ETFs, concentração das empresas e cobertura das posições.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExposicaoPage,
});

const identity = (value: string) => value;
function SliceSection({
  title,
  slices,
  hidden,
  translate = identity,
}: {
  title: string;
  slices: Slice[];
  hidden: boolean;
  translate?: (value: string) => string;
}) {
  const rows = useMemo(() => mergeDisplaySlices(slices, translate), [slices, translate]);
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <ExposureTable
        rows={rows}
        label={title}
        rowKey={(r) => r.value}
        rowLabel={(r) => r.value}
        pageSize={50}
        columns={[
          {
            id: "name",
            label: "Categoria",
            value: (r) => r.value,
            cell: (r) => (
              <details className="min-w-36 max-w-64">
                <summary className="cursor-pointer font-medium">{r.value}</summary>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {r.contributors.map((c) => (
                    <li key={c.assetId} className="flex justify-between gap-3">
                      <span>{c.name}</span>
                      <span className="num whitespace-nowrap">{exposureEUR(c.amount, hidden)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ),
          },
          {
            id: "amount",
            label: "Valor",
            numeric: true,
            value: (r) => r.amount,
            cell: (r) => exposureEUR(r.amount, hidden),
          },
          {
            id: "pct",
            label: "% carteira",
            numeric: true,
            value: (r) => r.pct,
            cell: (r) => (
              <div className="flex items-center justify-end gap-3">
                <div
                  aria-hidden
                  className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-secondary"
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${hidden ? 0 : Math.min(100, r.pct)}%` }}
                  />
                </div>
                <span className="w-16">{exposurePct(r.pct, hidden)}</span>
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}

const etfContributors = (company: CompanyExposure) => {
  const contributors = new Map<string, { assetId: string; name: string; amount: number }>();
  for (const c of company.contributors.filter((r) => r.via === "etf")) {
    const prior = contributors.get(c.assetId);
    if (prior) prior.amount += c.amount;
    else contributors.set(c.assetId, { ...c });
  }
  return [...contributors.values()].sort((a, b) => b.amount - a.amount);
};

function CompanyTable({ rows, hidden }: { rows: CompanyExposure[]; hidden: boolean }) {
  return (
    <section className="min-w-0 space-y-4">
      <h2 className="text-base font-semibold">Peso real por empresa</h2>
      <ExposureTable
        rows={rows}
        label="Peso real por empresa"
        rowKey={(r) => `${r.symbol ?? ""}|${r.name}`}
        rowLabel={(r) => r.name}
        searchText={(r) => `${r.name} ${r.symbol ?? ""}`}
        columns={[
          {
            id: "name",
            label: "Empresa",
            value: (r) => r.name,
            cell: (r) => (
              <div className="min-w-48 max-w-xs">
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.symbol ?? "—"}</p>
              </div>
            ),
          },
          {
            id: "indirect",
            label: "Via ETFs",
            numeric: true,
            value: (r) => r.indirect,
            cell: (r) => exposureEUR(r.indirect, hidden),
          },
          {
            id: "direct",
            label: "Direto",
            numeric: true,
            value: (r) => r.direct,
            cell: (r) => exposureEUR(r.direct, hidden),
          },
          {
            id: "total",
            label: "Total",
            numeric: true,
            value: (r) => r.amount,
            cell: (r) => <span className="font-medium">{exposureEUR(r.amount, hidden)}</span>,
          },
          {
            id: "etfs",
            label: "N.º ETFs",
            numeric: true,
            value: (r) => etfContributors(r).length,
            cell: (r) => {
              const etfs = etfContributors(r);
              return etfs.length ? (
                <details className="min-w-20 text-left">
                  <summary className="num cursor-pointer text-right">{etfs.length}</summary>
                  <ul className="mt-2 min-w-56 max-w-80 space-y-2 text-xs text-muted-foreground">
                    {etfs.map((etf) => (
                      <li key={etf.assetId}>
                        <p className="whitespace-normal">{etf.name}</p>
                        <p className="num">{exposureEUR(etf.amount, hidden)}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                "0"
              );
            },
          },
          {
            id: "pct",
            label: "% carteira",
            numeric: true,
            value: (r) => r.pct,
            cell: (r) => exposurePct(r.pct, hidden),
          },
        ]}
      />
    </section>
  );
}

function ExposicaoPage() {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const fetchExposure = useServerFn(getExposure);
  const syncFn = useServerFn(syncAllAssetExposure);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["exposure"],
    queryFn: () => fetchExposure(),
  });
  const reload = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["exposure"] }),
      queryClient.invalidateQueries({ queryKey: ["asset-exposure"] }),
    ]);
  };
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: async (res) => {
      toast.success(`Composição atualizada: ${res.updated} de ${res.total} ativos.`);
      await reload();
    },
    onError: () => toast.error("Não foi possível atualizar a composição."),
  });
  const managers = useMutation({
    mutationFn: () => syncManagerHoldings(),
    onSuccess: async (res) => {
      toast[res.failed ? "warning" : "success"](syncSummaryText(res));
      await reload();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const report = data?.report;
  const etfs = data?.meta.filter((m) => m.class === "etf") ?? [];
  const partial = etfs.filter((m) => m.holdingsStatus !== "full");
  const actions = (
    <>
      <Button
        variant="outline"
        onClick={() => sync.mutate()}
        loading={sync.isPending}
        disabled={managers.isPending}
      >
        <RefreshCw aria-hidden className="h-4 w-4" />
        Atualizar ações e REITs
      </Button>
      <Button
        onClick={() => managers.mutate()}
        loading={managers.isPending}
        disabled={sync.isPending}
      >
        <RefreshCw aria-hidden className="h-4 w-4" />
        Sincronizar com gestoras
      </Button>
    </>
  );
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="Exposição" actions={actions} />
      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isPending ? (
        <>
          <KpiGridSkeleton count={4} />
          <Skeleton className="h-64 w-full" />
        </>
      ) : !report || report.total === 0 ? (
        <EmptyState
          title="Sem exposição calculada"
          description="Não existem posições abertas na carteira."
        />
      ) : (
        <>
          {partial.length > 0 && (
            <div
              role="status"
              className="flex items-start gap-3 border-l-2 border-warning bg-warning/10 px-4 py-3 text-sm"
            >
              <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>
                <strong>{partial.length} ETFs com dados incompletos.</strong> As listas parciais
                subestimam o peso das empresas e a concentração apresentada.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard label="Valor do portefólio" value={exposureEUR(report.total, hidden)} />
            <MetricCard label="Cobertura geográfica" value={exposurePct(report.coverage, hidden)} />
            <MetricCard
              label="Maior empresa"
              value={exposurePct(report.concentration.largest, hidden)}
              sub={report.companies[0]?.name ?? "—"}
            />
            <MetricCard
              label="Top 10 empresas"
              value={exposurePct(report.concentration.top10, hidden)}
              sub={`Top 5: ${exposurePct(report.concentration.top5, hidden)}`}
            />
          </div>
          <CompanyTable rows={report.companies} hidden={hidden} />
          {etfs.length > 0 && <EtfCoverageTable rows={etfs} hidden={hidden} />}
          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            <ExposureBars
              title="Geografia"
              slices={report.country}
              hidden={hidden}
              kind="country"
            />
            <ExposureBars
              title="Setores"
              slices={report.sector}
              hidden={hidden}
              kind="sector"
            />
            <SliceSection title="Por classe de ativo" slices={report.byClass} hidden={hidden} />
            <SliceSection title="Por moeda económica" slices={report.currency} hidden={hidden} />
            <SliceSection title="Por região" slices={report.region} hidden={hidden} />
            <SliceSection title="Por continente" slices={report.continent} hidden={hidden} />
            <SliceSection
              title="Desenvolvido vs. emergente"
              slices={report.development}
              hidden={hidden}
            />
            <SliceSection
              title="Por indústria"
              slices={report.industry}
              hidden={hidden}
              translate={exposureSector}
            />
          </div>
        </>
      )}
    </div>
  );
}
