import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getAssetExposure, syncAssetExposure } from "@/lib/exposure.functions";
import { formatDatePt } from "@/lib/format";
import { Button } from "@/components/ui-bits";
import { ExposureTable } from "@/components/exposure-table";
import { HoldingsStatus } from "@/components/etf-coverage";
import {
  exposureCountry,
  exposurePct,
  exposureSector,
  mergeDisplayDimensions,
  readableCompanyName,
} from "@/lib/exposure-display";
import { syncManagerHoldings, syncSummaryText } from "@/lib/holdings-sync";
import { privateExposureEUR } from "@/components/private-value";
import { Stat } from "@/components/asset-position-bits";

/** Exposição subjacente do ativo — lê a mesma fonte persistida da página Exposição. */
export function UnderlyingExposure({
  assetId,
  hidden,
  isEtf,
}: {
  assetId: string;
  hidden: boolean;
  isEtf: boolean;
}) {
  const queryClient = useQueryClient();
  const fetchFn = useServerFn(getAssetExposure);
  const syncFn = useServerFn(syncAssetExposure);
  const [syncing, setSyncing] = useState(false);
  const {
    data: d,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["asset-exposure", assetId],
    queryFn: () => fetchFn({ data: { assetId } }),
  });
  const sync = async () => {
    setSyncing(true);
    try {
      if (isEtf) {
        const result = await syncManagerHoldings(assetId);
        toast[result.failed ? "warning" : "success"](syncSummaryText(result));
      } else {
        const result = await syncFn({ data: { assetId } });
        toast[result.ok ? "success" : "message"](
          result.ok ? "Composição atualizada." : (result.message ?? "Sem dados novos."),
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["asset-exposure", assetId] }),
        queryClient.invalidateQueries({ queryKey: ["exposure"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível sincronizar.");
    } finally {
      setSyncing(false);
    }
  };
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase text-muted-foreground">
          Exposição subjacente
        </h3>
        <Button variant="outline" onClick={sync} loading={syncing}>
          {isEtf ? "Sincronizar com gestoras" : "Atualizar composição"}
        </Button>
      </div>
      {isPending ? (
        <p className="text-sm text-muted-foreground">A carregar composição…</p>
      ) : isError ? (
        <Button variant="outline" onClick={() => void refetch()}>
          Voltar a tentar
        </Button>
      ) : !d ? (
        <p>Dados não disponíveis</p>
      ) : (
        <>
          {isEtf && (
            <HoldingsStatus
              status={d.holdingsStatus}
              count={d.holdings.length}
              coverage={d.coverage}
              error={d.holdingsError}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Cobertura: {exposurePct(d.coverage)} · {formatDatePt(d.asOfDate)} ·{" "}
            {d.source ?? "Não disponível"}
          </p>
          {d.profile && (
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label="Tipo" value={d.profile.assetType ?? "—"} />
              <Stat label="Moeda de cotação" value={d.profile.currency ?? "—"} />
              <Stat
                label="Domicílio"
                value={d.profile.domicile ? exposureCountry(d.profile.domicile) : "—"}
              />
              <Stat
                label="Yield"
                value={d.profile.dividendYield == null ? "—" : exposurePct(d.profile.dividendYield)}
              />
            </div>
          )}
          {d.dimensions.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {mergeDisplayDimensions(d.dimensions).map((x, i) => (
                <li key={`${x.dimension}-${x.value}-${i}`} className="flex justify-between gap-4">
                  <span>
                    {DIM_LABELS[x.dimension] ?? x.dimension}: {x.value}
                  </span>
                  <span className="num whitespace-nowrap">{exposurePct(x.pct)}</span>
                </li>
              ))}
            </ul>
          )}
          {d.holdings.length > 0 && (
            <ExposureTable
              rows={d.holdings}
              label="Posições do ETF"
              rowKey={(h) => `${h.symbol ?? ""}|${h.name}`}
              rowLabel={(h) => h.name}
              searchText={(h) => `${h.name} ${h.symbol ?? ""}`}
              columns={[
                {
                  id: "name",
                  label: "Posição",
                  value: (h) => h.name,
                  cell: (h) => (
                    <div className="min-w-40">
                      <p>{readableCompanyName(h.name)}</p>
                      <p className="text-xs text-muted-foreground">{h.symbol}</p>
                    </div>
                  ),
                },
                {
                  id: "country",
                  label: "País",
                  value: (h) => h.country,
                  cell: (h) => (h.country ? exposureCountry(h.country) : "—"),
                },
                {
                  id: "sector",
                  label: "Setor",
                  value: (h) => h.sector,
                  cell: (h) => (h.sector ? exposureSector(h.sector) : "—"),
                },
                {
                  id: "amount",
                  label: "Valor",
                  numeric: true,
                  value: (h) => h.amount,
                  cell: (h) => privateExposureEUR(h.amount, hidden),
                },
                {
                  id: "pct",
                  label: "Peso",
                  numeric: true,
                  value: (h) => h.pct,
                  cell: (h) => exposurePct(h.pct),
                },
              ]}
            />
          )}
        </>
      )}
    </section>
  );
}

const DIM_LABELS: Record<string, string> = {
  country: "País",
  sector: "Setor",
  industry: "Indústria",
  currency: "Moeda",
};
