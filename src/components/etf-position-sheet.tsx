import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, RefreshCw, Layers, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { getAssetExposure, getExposure, type AssetExposureDetail } from "@/lib/exposure.functions";
import type { Asset } from "@/lib/portfolio-types";
import {
  exposureEUR,
  exposurePct,
  mergeDisplaySlices,
  readableCompanyName,
} from "@/lib/exposure-display";
import { countryFlag, countryLabel, sectorColor } from "@/lib/exposure-visuals";
import { detailSlices, equityHolding, managerName } from "@/lib/etf-sheet";
import { holdingIndex } from "@/lib/holding-identity";
import { etfOverlap } from "@/lib/overlap";
import { syncManagerHoldings, syncSummaryText } from "@/lib/holdings-sync";
import { formatDatePt } from "@/lib/format";
import { Badge, Button, EmptyState, ErrorState, IconButton } from "@/components/ui-bits";
import { HoldingsStatus } from "@/components/etf-coverage";
import { ExposureBars } from "@/components/exposure-bars";
import { ExposureTable } from "@/components/exposure-table";
import { Skeleton } from "@/components/ui/skeleton";

export function EtfPositionSheet({
  asset,
  hidden,
  unrealized,
  costBasis,
}: {
  asset: Asset;
  hidden: boolean;
  unrealized: number;
  costBasis: number;
}) {
  const fetchDetail = useServerFn(getAssetExposure);
  const fetchPortfolio = useServerFn(getExposure);
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["asset-exposure", asset.id],
    queryFn: () => fetchDetail({ data: { assetId: asset.id } }),
    staleTime: 5 * 60_000,
  });
  const portfolio = useQuery({
    queryKey: ["exposure"],
    queryFn: () => fetchPortfolio(),
    staleTime: 5 * 60_000,
  });
  const sync = useMutation({
    mutationFn: () => syncManagerHoldings(asset.id),
    onSuccess: async (res) => {
      toast[res.failed ? "warning" : "success"](syncSummaryText(res));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["asset-exposure", asset.id] }),
        client.invalidateQueries({ queryKey: ["exposure"] }),
      ]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (detail.isPending)
    return (
      <section aria-label="A carregar ficha ETF" aria-busy className="space-y-5">
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </section>
    );
  if (detail.isError) return <ErrorState onRetry={() => void detail.refetch()} />;
  if (!detail.data) return <EmptyState title="Sem composição disponível" />;
  return (
    <EtfSheetContent
      key={asset.id}
      asset={asset}
      detail={detail.data}
      portfolio={portfolio.data}
      portfolioPending={portfolio.isPending}
      portfolioError={portfolio.isError}
      retryPortfolio={() => void portfolio.refetch()}
      hidden={hidden}
      unrealized={unrealized}
      costBasis={costBasis}
      syncing={sync.isPending}
      onSync={() => sync.mutate()}
    />
  );
}

export function EtfSheetContent({
  asset,
  detail: d,
  portfolio,
  portfolioPending = false,
  portfolioError = false,
  retryPortfolio,
  hidden,
  unrealized,
  costBasis,
  syncing = false,
  onSync,
}: {
  asset: Asset;
  detail: AssetExposureDetail;
  portfolio?: Awaited<ReturnType<typeof getExposure>>;
  portfolioPending?: boolean;
  portfolioError?: boolean;
  retryPortfolio?: () => void;
  hidden: boolean;
  unrealized: number;
  costBasis: number;
  syncing?: boolean;
  onSync: () => void;
}) {
  const [all, setAll] = useState(false);
  const sectors = useMemo(() => mergeDisplaySlices(detailSlices(d, "sector"), (s) => s), [d]);
  const countries = useMemo(
    () => mergeDisplaySlices(detailSlices(d, "country"), countryLabel),
    [d],
  );
  const total = portfolio?.report.total;
  const etfTotal = portfolio?.meta
    .filter((m) => m.class === "etf")
    .reduce((s, m) => s + m.value, 0);
  const largest = d.holdings[0];
  const top10 = d.holdings.slice(0, 10).reduce((s, h) => s + h.pct, 0);
  const dominant = [...sectors].sort((a, b) => b.pct - a.pct)[0];
  const cash = d.holdings
    .filter((h) => !equityHolding(h) && /cash|derivative|future|\bfx\b/i.test(h.assetClass ?? ""))
    .reduce((s, h) => s + h.pct, 0);
  const cross = useMemo(() => {
    const positions = portfolio?.positions ?? [];
    const direct = holdingIndex(
      positions
        .filter((p) => ["acao_dividendo", "acao_crescimento", "reit"].includes(p.class))
        .map((p) => ({ name: p.name, symbol: p.ticker, isin: p.isin })),
    );
    const other = positions
      .filter((p) => p.class === "etf" && p.assetId !== asset.id)
      .map((p) => ({
        find: holdingIndex(p.holdings.filter((h) => equityHolding(h))),
        id: p.assetId,
      }));
    return new Map(
      d.holdings.map((h) => [
        h,
        { direct: !!direct(h), etfs: other.filter((p) => p.find(h)).length },
      ]),
    );
  }, [portfolio, d, asset.id]);
  const overlaps = useMemo(() => {
    if (d.holdingsStatus !== "full" || !portfolio) return [];
    const complete = new Set(
      portfolio.meta.filter((m) => m.holdingsStatus === "full").map((m) => m.assetId),
    );
    const current = {
      assetId: asset.id,
      name: asset.name,
      holdings: d.holdings.filter(equityHolding).map((h) => ({ ...h, weight: h.pct / 100 })),
    };
    return portfolio.positions
      .filter((p) => p.class === "etf" && p.assetId !== asset.id && complete.has(p.assetId))
      .flatMap((p) =>
        etfOverlap([
          current,
          { assetId: p.assetId, name: p.name, holdings: p.holdings.filter(equityHolding) },
        ]),
      )
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 5);
  }, [portfolio, d, asset]);
  const isin = asset.isin ?? d.profile?.isin;
  const copy = async () => {
    if (!isin) return;
    try {
      await navigator.clipboard.writeText(isin);
      toast.success("ISIN copiado.");
    } catch {
      toast.error("Não foi possível copiar o ISIN.");
    }
  };
  const pct = (denominator?: number) =>
    denominator && denominator > 0 ? exposurePct((d.value / denominator) * 100, hidden) : "—";
  return (
    <div className="min-w-0 space-y-7">
      <header className="space-y-4 border-b border-border pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">
              <Layers aria-hidden className="mr-1 inline h-3 w-3" />
              {managerName(d.profile?.managerSlug, d.source)}
            </Badge>
            <span className="text-sm font-medium">{asset.ticker}</span>
            {isin && (
              <span className="num inline-flex items-center gap-1 text-xs text-muted-foreground">
                {isin}
                <IconButton label="Copiar ISIN" onClick={() => void copy()}>
                  <Copy className="h-3.5 w-3.5" />
                </IconButton>
              </span>
            )}
          </div>
          <Button size="sm" variant="outline" loading={syncing} onClick={onSync}>
            <RefreshCw className="h-3.5 w-3.5" />
            Sincronizar com gestoras
          </Button>
        </div>
        {d.profile?.indexTracked && (
          <p className="text-sm text-muted-foreground">
            Índice · <span className="text-foreground">{d.profile.indexTracked}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <HoldingsStatus
            status={d.holdingsStatus}
            count={d.profile?.holdingsCount ?? d.holdings.length}
            coverage={d.coverage}
            error={d.holdingsError}
            hidden={hidden}
          />
          <span className="text-xs text-muted-foreground">Dados de {formatDatePt(d.asOfDate)}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <p className="text-xs text-muted-foreground">Valor da posição</p>
            <p className="num mt-1 text-3xl font-semibold">{exposureEUR(d.value, hidden)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Peso na carteira / nos ETFs</p>
            <p className="num mt-2 text-lg font-medium">
              {pct(total)} <span className="text-muted-foreground">/</span> {pct(etfTotal)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Mais-valia latente</p>
            <p
              className={`num mt-2 text-lg font-medium ${unrealized >= 0 ? "text-success" : "text-destructive"}`}
            >
              {exposureEUR(unrealized, hidden)}{" "}
              <span className="text-sm">
                ({costBasis > 0 ? exposurePct((unrealized / costBasis) * 100, hidden) : "—"})
              </span>
            </p>
          </div>
        </div>
      </header>
      {d.holdingsStatus !== "full" && (
        <p
          role="status"
          className="border-l-2 border-warning bg-warning/10 px-3 py-2 text-xs text-muted-foreground"
        >
          Composição incompleta. As posições e concentrações refletem apenas os dados disponíveis.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Posições"
          value={(d.profile?.holdingsCount ?? d.holdings.length).toLocaleString("pt-PT")}
        />
        <Kpi label="Top 10" value={exposurePct(top10, hidden)} />
        <Kpi
          label="Maior posição"
          value={largest ? exposurePct(largest.pct, hidden) : "—"}
          sub={largest ? readableCompanyName(largest.name) : undefined}
        />
        <Kpi
          label="Países"
          value={String(
            countries.filter(
              (c) =>
                !["Não disponível", "Outros", "Liquidez e derivados"].includes(c.value) &&
                c.pct > 0,
            ).length,
          )}
        />
        <Kpi
          label="Setor dominante"
          value={dominant ? exposurePct(dominant.pct, hidden) : "—"}
          sub={dominant?.value}
        />
        {cash > 0 && <Kpi label="Liquidez / derivados" value={exposurePct(cash, hidden)} />}
      </div>
      <div className="grid min-w-0 gap-7 lg:grid-cols-2">
        <ExposureBars title="Setores" slices={sectors} kind="sector" basis="ETF" hidden={hidden} />
        <ExposureBars
          title="Geografia"
          slices={countries}
          kind="country"
          basis="ETF"
          hidden={hidden}
        />
      </div>
      <section className="min-w-0 space-y-3">
        <header className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{all ? "Todas as posições" : "Principais posições"}</h3>
          <Button size="sm" variant="outline" onClick={() => setAll(!all)}>
            {all ? "Ver top 10" : "Ver todas"}
          </Button>
        </header>
        {portfolioError && retryPortfolio && <ErrorState onRetry={retryPortfolio} />}
        <ExposureTable
          key={all ? "all" : "top"}
          rows={all ? d.holdings : d.holdings.slice(0, 10)}
          label="Posições do ETF"
          rowKey={(h) => `${h.isin ?? ""}|${h.symbol ?? ""}|${h.name}`}
          rowLabel={(h) => h.name}
          searchText={all ? (h) => `${h.name} ${h.symbol ?? ""} ${h.isin ?? ""}` : undefined}
          columns={[
            {
              id: "name",
              label: "Empresa",
              value: (h) => h.name,
              cell: (h) => (
                <div className="min-w-48 max-w-xs">
                  <p className="font-medium">{readableCompanyName(h.name)}</p>
                  {cross.get(h)?.direct && <Badge tone="gain">Também detida diretamente</Badge>}
                  {(cross.get(h)?.etfs ?? 0) > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Em {(cross.get(h)?.etfs ?? 0) + 1} ETFs
                    </p>
                  )}
                </div>
              ),
            },
            {
              id: "symbol",
              label: "Ticker",
              value: (h) => h.symbol,
              cell: (h) => <span className="text-xs text-muted-foreground">{h.symbol ?? "—"}</span>,
            },
            {
              id: "sector",
              label: "Setor",
              value: (h) => h.sector,
              cell: (h) => (
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: sectorColor(h.sector ?? "") }}
                  />
                  {h.sector
                    ? detailSlices(
                        { ...d, dimensions: [{ dimension: "sector", value: h.sector, pct: 0 }] },
                        "sector",
                      )[0]?.value
                    : "—"}
                </span>
              ),
            },
            {
              id: "country",
              label: "País",
              value: (h) => h.country,
              cell: (h) =>
                h.country ? (
                  <span className="whitespace-nowrap">
                    {countryFlag(h.country)} {countryLabel(h.country)}
                  </span>
                ) : (
                  "—"
                ),
            },
            {
              id: "pct",
              label: "% ETF",
              numeric: true,
              value: (h) => h.pct,
              cell: (h) => exposurePct(h.pct, hidden),
            },
            {
              id: "amount",
              label: "Valor",
              numeric: true,
              value: (h) => h.amount,
              cell: (h) => exposureEUR(h.amount, hidden),
            },
            {
              id: "portfolio",
              label: "% carteira",
              numeric: true,
              value: (h) => h.pct,
              cell: (h) =>
                total && total > 0 ? exposurePct((h.amount / total) * 100, hidden) : "—",
            },
          ]}
        />
      </section>
      {d.holdingsStatus === "full" && (
        <section className="space-y-3 border-t border-border pt-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <ArrowUpRight className="h-4 w-4 text-primary" />
            Sobreposição com outros ETFs
          </h3>
          {portfolioPending ? (
            <Skeleton className="h-32 w-full" />
          ) : portfolioError && retryPortfolio ? (
            <ErrorState onRetry={retryPortfolio} />
          ) : overlaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sem outros ETFs com composição completa para comparar.
            </p>
          ) : (
            <ul className="space-y-4">
              {overlaps.map((p) => (
                <li key={p.b}>
                  <div className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      {p.bName}
                      <span className="block text-xs text-muted-foreground">
                        {p.commonCount.toLocaleString("pt-PT")} empresas em comum
                      </span>
                    </span>
                    <span className="num shrink-0 font-medium">
                      {exposurePct(p.overlap * 100, hidden)}
                    </span>
                  </div>
                  <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-sm bg-secondary">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${hidden ? 0 : Math.min(100, p.overlap * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Valores altos indicam ETFs redundantes: maior peso nas mesmas empresas.
          </p>
        </section>
      )}
    </div>
  );
}
function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-secondary/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num mt-2 text-lg font-semibold">{value}</p>
      {sub && <p className="mt-1 break-words text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
