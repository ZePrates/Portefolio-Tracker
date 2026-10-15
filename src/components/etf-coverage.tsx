import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getExposure, type AssetExposureMeta } from "@/lib/exposure.functions";
import { exposurePct } from "@/lib/exposure-display";
import { formatDatePt } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { Badge, ErrorState } from "@/components/ui-bits";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ExposureTable } from "@/components/exposure-table";
import { privateExposureEUR } from "@/components/private-value";

export function HoldingsStatus({
  status,
  count,
  coverage,
  error,
}: {
  status: string | null;
  count: number;
  coverage: number;
  error: string | null;
}) {
  if (status === "error")
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-flex">
              <Badge tone="loss">Erro</Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs break-words">
            {error ?? "A última sincronização falhou; dados anteriores preservados."}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  if (status === "full")
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="gain">Completo</Badge>
        <span className="num text-xs text-muted-foreground">
          {count.toLocaleString("pt-PT")} posições
        </span>
      </div>
    );
  if (status === "partial")
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warn">Parcial — top 10</Badge>
        <span className="num text-xs text-muted-foreground">{exposurePct(coverage)}</span>
      </div>
    );
  return <Badge>Não disponível</Badge>;
}

const sourceName = (source: string | null) => {
  const base = source?.split(":")[0] ?? "";
  return (
    (
      {
        ishares: "iShares",
        vanguard: "Vanguard",
        xtrackers: "Xtrackers",
        globalx: "Global X",
        vaneck: "VanEck",
        justetf: "justETF",
        "justetf+ft": "justETF + Financial Times",
        ft: "Financial Times",
        yahoo: "Yahoo Finance",
      } as Record<string, string>
    )[base] ??
    (base || "—")
  );
};

export function EtfCoverageTable({ rows, hidden }: { rows: AssetExposureMeta[]; hidden: boolean }) {
  return (
    <section className="min-w-0 space-y-4">
      <h2 className="text-base font-semibold">Cobertura por ETF</h2>
      <ExposureTable
        rows={rows}
        label="Cobertura por ETF"
        rowKey={(r) => r.assetId}
        rowLabel={(r) => r.name}
        columns={[
          {
            id: "name",
            label: "ETF",
            value: (r) => r.name,
            cell: (r) => (
              <div className="min-w-56 max-w-sm">
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.ticker}</p>
              </div>
            ),
          },
          {
            id: "value",
            label: "Valor",
            numeric: true,
            value: (r) => r.value,
            cell: (r) => privateExposureEUR(r.value, hidden),
          },
          {
            id: "status",
            label: "Posições / cobertura",
            value: (r) => r.coverage,
            cell: (r) => (
              <div className="min-w-44">
                <HoldingsStatus
                  status={r.holdingsStatus}
                  count={r.holdingsCount}
                  coverage={r.coverage}
                  error={r.holdingsError}
                />
              </div>
            ),
          },
          {
            id: "source",
            label: "Fonte",
            value: (r) => sourceName(r.source),
            cell: (r) => (
              <span className="whitespace-nowrap text-muted-foreground">
                {sourceName(r.source)}
              </span>
            ),
          },
          {
            id: "date",
            label: "Data das posições",
            value: (r) => r.asOfDate,
            cell: (r) => (
              <span className="num whitespace-nowrap text-muted-foreground">
                {formatDatePt(r.asOfDate)}
              </span>
            ),
          },
        ]}
      />
    </section>
  );
}

export function EtfCoverageSection() {
  const fetchExposure = useServerFn(getExposure);
  const { hidden } = usePrivateMode();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["exposure"],
    queryFn: () => fetchExposure(),
  });
  if (isPending)
    return <p className="text-sm text-muted-foreground">A carregar cobertura dos ETFs…</p>;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  const rows = data?.meta.filter((m) => m.class === "etf") ?? [];
  return rows.length ? <EtfCoverageTable rows={rows} hidden={hidden} /> : null;
}
