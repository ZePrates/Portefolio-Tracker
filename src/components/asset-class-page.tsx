import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  type Asset,
  type AssetClass,
  assetCurrentValue,
  assetInvested,
  assetRealizedPL,
  isOpenPosition,
} from "@/lib/portfolio-types";
import { AssetPositionModal } from "@/components/asset-position-modal";
import { AssetFormDialog } from "@/components/asset-form-dialog";
import { ClosedAssetsTable, OpenAssetsTable } from "@/components/asset-class-tables";
import { invalidatePortfolio } from "@/lib/portfolio-queries";
import { listAssets, deleteAsset } from "@/lib/portfolio.functions";
import { updateAllPrices } from "@/lib/prices.functions";
import { syncDividendsForAsset } from "@/lib/dividends.functions";
import { formatPercent } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import {
  PageHeader,
  MetricCard,
  EmptyState,
  ErrorState,
  Button,
  useConfirm,
} from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { privateEUR } from "@/components/private-value";

interface Props {
  assetClass: AssetClass;
  title: string;
  subtitle: string;
  emptyLabel?: string;
}

/**
 * Página de uma classe de ativos: totais, posições abertas e fechadas, a
 * ficha de cada posição e o formulário para adicionar ou editar.
 */
export function AssetClassPage({ assetClass, title, subtitle, emptyLabel }: Props) {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const fetchAssets = useServerFn(listAssets);
  const deleteFn = useServerFn(deleteAsset);
  const refreshFn = useServerFn(updateAllPrices);
  const syncDivFn = useServerFn(syncDividendsForAsset);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  // Nova chave a cada abertura: o formulário recomeça do zero.
  const [dialogKey, setDialogKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [positionAsset, setPositionAsset] = useState<Asset | null>(null);

  const {
    data: allAssets,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetchAssets(),
  });

  const classAssets = useMemo(
    () => ((allAssets ?? []) as Asset[]).filter((a) => a.class === assetClass),
    [allAssets, assetClass],
  );
  const assets = useMemo(() => classAssets.filter(isOpenPosition), [classAssets]);
  const closedAssets = useMemo(() => classAssets.filter((a) => !isOpenPosition(a)), [classAssets]);

  // Vindo da pesquisa global (?ativo=<id>): abre a ficha desse ativo e limpa o parâmetro.
  const navigate = useNavigate();
  const { ativo } = useSearch({ strict: false }) as { ativo?: string };
  useEffect(() => {
    if (!ativo || !allAssets) return;
    const target = classAssets.find((a) => a.id === ativo);
    if (target) setPositionAsset(target);
    void navigate({ to: ".", search: {}, replace: true });
  }, [ativo, allAssets, classAssets, navigate]);

  const realizedTotal = classAssets.reduce((s, a) => s + assetRealizedPL(a), 0);

  const totals = assets.reduce(
    (acc, a) => {
      acc.invested += assetInvested(a);
      acc.current += assetCurrentValue(a);
      return acc;
    },
    { invested: 0, current: 0 },
  );
  const pl = totals.current - totals.invested;
  const plPct = totals.invested > 0 ? (pl / totals.invested) * 100 : 0;
  const yields = assets
    .map((asset) => asset.annual_yield)
    .filter((value): value is number => value != null);
  const averageYield =
    yields.length > 0 ? yields.reduce((sum, value) => sum + value, 0) / yields.length : null;
  const lastPriceUpdate = assets.reduce<string | null>(
    (acc, a) =>
      a.price_updated_at && (!acc || a.price_updated_at > acc) ? a.price_updated_at : acc,
    null,
  );

  const openDialog = (a: Asset | null) => {
    setEditing(a);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  };
  const openCreate = () => openDialog(null);

  const importDividends = async (a: Asset) => {
    setImportingId(a.id);
    const id = toast.loading(`A atualizar dividendos de ${a.name}…`);
    try {
      const res = (await syncDivFn({ data: { assetId: a.id } })) as {
        status: string;
        reason?: string;
        inserted: number;
        updated: number;
      };
      await invalidatePortfolio(queryClient);
      if (res.status !== "ok") {
        toast.warning(res.reason ?? "Dados de dividendos indisponíveis.", { id });
      } else {
        toast.success(
          res.inserted > 0
            ? `${res.inserted} dividendos novos (${res.updated} atualizados).`
            : `Sem dividendos novos (${res.updated} atualizados).`,
          { id },
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar os dividendos.", { id });
    } finally {
      setImportingId(null);
    }
  };

  const remove = async (a: Asset) => {
    const ok = await confirm({
      title: `Eliminar "${a.name}"?`,
      description:
        "A posição e todos os movimentos e dividendos associados deixam de aparecer na carteira. Esta ação não pode ser anulada.",
      confirmLabel: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFn({ data: { id: a.id } });
      toast.success("Ativo eliminado.");
      await invalidatePortfolio(queryClient);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao eliminar.");
    }
  };

  const refreshPrices = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const toastId = toast.loading("A obter cotações do Yahoo Finance…");
    try {
      const res = (await refreshFn({ data: { class: assetClass } })) as {
        updated: number;
        failed: string[];
        total: number;
      };
      await invalidatePortfolio(queryClient);
      if (res.updated === 0 && res.total === 0) {
        toast.info("Não há ativos com ticker nesta página.", { id: toastId });
      } else if (res.failed.length > 0) {
        toast.warning(
          `${res.updated} cotações atualizadas. Sem cotação: ${res.failed.join(", ")}`,
          {
            id: toastId,
          },
        );
      } else {
        toast.success(`${res.updated} cotações atualizadas.`, { id: toastId });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar as cotações.", {
        id: toastId,
      });
    } finally {
      setRefreshing(false);
    }
  };

  const tableProps = {
    assetClass,
    title,
    hidden,
    importingId,
    onOpen: setPositionAsset,
    onEdit: openDialog,
    onRemove: (a: Asset) => void remove(a),
    onImportDividends: (a: Asset) => void importDividends(a),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <Button variant="outline" onClick={refreshPrices} loading={refreshing}>
              {!refreshing && <RefreshCw aria-hidden className="h-4 w-4" />}
              Atualizar<span className="hidden sm:inline"> cotações</span>
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </>
        }
      />

      {assetClass !== "etf" && lastPriceUpdate && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Cotações atualizadas em {new Date(lastPriceUpdate).toLocaleString("pt-PT")} · fonte de
          mercado (Yahoo Finance), sem estimativas.
        </p>
      )}

      <div
        className={cn(
          "grid grid-cols-2 gap-3 md:gap-4",
          assetClass === "reit" || assetClass === "acao_dividendo"
            ? "xl:grid-cols-6"
            : "xl:grid-cols-5",
        )}
      >
        <MetricCard label="Valor atual" value={privateEUR(totals.current, hidden)} />
        <MetricCard label="Total investido" value={privateEUR(totals.invested, hidden)} />
        <MetricCard
          label="P/L não realizado"
          value={privateEUR(pl, hidden)}
          sub={formatPercent(plPct)}
          tone={pl > 0 ? "positive" : pl < 0 ? "negative" : "default"}
        />
        <MetricCard
          label="P/L realizado"
          value={privateEUR(realizedTotal, hidden)}
          sub={
            closedAssets.length > 0
              ? `${closedAssets.length} posições fechadas`
              : "Vendas concretizadas"
          }
          tone={realizedTotal > 0 ? "positive" : realizedTotal < 0 ? "negative" : "default"}
        />
        <MetricCard label="Posições abertas" value={String(assets.length)} />
        {(assetClass === "reit" || assetClass === "acao_dividendo") && (
          <MetricCard
            label="Yield médio"
            value={averageYield == null ? "—" : formatPercent(averageYield)}
            sub={yields.length > 0 ? `${yields.length} ativos com dados` : "Dados não disponíveis"}
          />
        )}
      </div>

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div
          aria-busy="true"
          aria-label="A carregar posições"
          className="space-y-2 rounded-xl border border-border bg-card p-4"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <EmptyState
          title={emptyLabel ?? "Ainda não tens posições aqui"}
          description="Adiciona o primeiro ativo para começar a acompanhar esta classe."
          action={
            <Button onClick={openCreate}>
              <Plus aria-hidden className="h-4 w-4" />
              Adicionar primeiro ativo
            </Button>
          }
        />
      ) : (
        <OpenAssetsTable {...tableProps} rows={assets} />
      )}

      {closedAssets.length > 0 && (
        <section aria-labelledby="posicoes-fechadas" className="space-y-3">
          <div>
            <h2 id="posicoes-fechadas" className="text-lg font-semibold">
              Posições fechadas
            </h2>
            <p className="text-sm text-muted-foreground">
              Ativos totalmente vendidos — o histórico permanece disponível.
            </p>
          </div>
          <ClosedAssetsTable {...tableProps} rows={closedAssets} />
        </section>
      )}

      <AssetPositionModal asset={positionAsset} onClose={() => setPositionAsset(null)} />

      <AssetFormDialog
        key={dialogKey}
        assetClass={assetClass}
        open={dialogOpen}
        editing={editing}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
