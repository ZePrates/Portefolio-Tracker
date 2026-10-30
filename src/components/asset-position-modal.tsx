import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidatePortfolio } from "@/lib/portfolio-queries";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { Asset } from "@/lib/portfolio-types";
import { getPosition } from "@/lib/portfolio.functions";
import { deleteExpense, listExpenses } from "@/lib/expenses.functions";
import type { MetalSummary } from "@/lib/metals";
import { MetalPositionPanel, type MetalExpenseRow } from "@/components/metal-position-panel";
import { formatDatePt, formatNumber, formatQuantity } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { Modal, useConfirm } from "@/components/ui-bits";
import { EtfPositionSheet } from "@/components/etf-position-sheet";
import { privateEUR } from "@/components/private-value";
import { Stat } from "@/components/asset-position-bits";
import { pnlTone as tone } from "@/lib/utils";
import { TradePanel } from "@/components/asset-position-trade";
import { TransactionHistory, type PositionTx } from "@/components/asset-position-history";
import {
  OpenLots,
  PositionDividends,
  type PositionLot,
} from "@/components/asset-position-dividends";
import { UnderlyingExposure } from "@/components/asset-underlying-exposure";

interface Props {
  asset: Asset | null;
  onClose: () => void;
}

/**
 * Ficha de uma posição: resumo, comprar/vender, dividendos, lotes FIFO e
 * histórico de movimentos (ETFs e metais têm painel próprio no topo).
 */
export function AssetPositionModal({ asset, onClose }: Props) {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const askConfirm = useConfirm();
  const positionFn = useServerFn(getPosition);
  const expensesFn = useServerFn(listExpenses);
  const deleteExpenseFn = useServerFn(deleteExpense);
  const [removingExpense, setRemovingExpense] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["position", asset?.id],
    queryFn: () => positionFn({ data: { assetId: asset!.id } }),
    enabled: !!asset,
  });

  const isMetal = asset?.class === "metal";
  const { data: expenseRows } = useQuery({
    queryKey: ["expenses", asset?.id],
    queryFn: () => expensesFn({ data: { assetId: asset!.id } }),
    enabled: !!asset && isMetal,
  });
  const expenses = (expenseRows ?? []) as MetalExpenseRow[];

  if (!asset) return null;

  const pos = data as
    | {
        lots: PositionLot[];
        transactions: PositionTx[];
        quantity: number;
        costBasis: number;
        currentValue: number;
        unrealizedPL: number;
        realizedPL: number;
        totalPL: number;
        metal: MetalSummary | null;
      }
    | undefined;
  const metal = pos?.metal ?? null;
  // Ágio sugerido = o da última compra (o escalão raramente muda).
  const lastPremium = metal?.lots.at(-1)?.premiumRate ?? null;

  const refresh = async () => {
    await invalidatePortfolio(queryClient);
  };

  const removeExpense = async (e: MetalExpenseRow) => {
    const ok = await askConfirm({
      title: `Apagar a taxa de ${formatDatePt(e.incurred_at)}?`,
      description:
        Number(e.grams_deducted) > 0
          ? "Os gramas deduzidos voltam à posição e o custo por grama é recalculado."
          : "A despesa deixa de contar nos custos.",
      confirmLabel: "Apagar",
      destructive: true,
    });
    if (!ok) return;
    if (removingExpense) return;
    setRemovingExpense(true);
    try {
      await deleteExpenseFn({ data: { id: e.id } });
      toast.success("Taxa apagada.");
      await queryClient.invalidateQueries({ queryKey: ["expenses", asset.id] });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível apagar a taxa.");
    } finally {
      setRemovingExpense(false);
    }
  };

  return (
    <Modal open={!!asset} onClose={onClose} title={asset.name} size="lg">
      <div className="space-y-5">
        {isLoading || !pos ? (
          <p className="text-sm text-muted-foreground">A carregar posição…</p>
        ) : (
          <>
            {asset.class === "etf" ? (
              <EtfPositionSheet
                asset={asset}
                hidden={hidden}
                unrealized={pos.unrealizedPL}
                costBasis={pos.costBasis}
              />
            ) : metal ? (
              <MetalPositionPanel
                summary={metal}
                expenses={expenses}
                custody={{
                  custodian: asset.custodian ?? null,
                  vault_ref: asset.vault_ref ?? null,
                  plan_name: asset.plan_name ?? null,
                }}
                hidden={hidden}
                onDeleteExpense={removeExpense}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Quantidade" value={formatQuantity(pos.quantity)} />
                <Stat label="Custo (FIFO)" value={privateEUR(pos.costBasis, hidden)} />
                <Stat
                  label="P/L não realizado"
                  value={privateEUR(pos.unrealizedPL, hidden)}
                  className={tone(pos.unrealizedPL)}
                />
                <Stat
                  label="P/L realizado"
                  value={privateEUR(pos.realizedPL, hidden)}
                  className={tone(pos.realizedPL)}
                />
              </div>
            )}
            {metal && pos.realizedPL !== 0 && (
              <p className="text-xs text-muted-foreground">
                P/L realizado em vendas: {privateEUR(pos.realizedPL, hidden)}
              </p>
            )}

            {(asset.price_source || asset.price_updated_at) && (
              <p className="text-xs text-muted-foreground">
                Preço: {asset.price_source ?? "manual"}
                {asset.price_updated_at
                  ? ` · atualizado em ${new Date(asset.price_updated_at).toLocaleString("pt-PT")}`
                  : ""}
                {asset.fx_rate && asset.native_currency !== "EUR"
                  ? ` · câmbio ${asset.native_currency}→EUR ${formatNumber(asset.fx_rate, 4)}`
                  : ""}
              </p>
            )}

            <TradePanel
              key={asset.id}
              asset={asset}
              available={pos.quantity}
              lastPremium={lastPremium}
              hidden={hidden}
              onChanged={refresh}
            />

            {!isMetal && (
              <>
                {asset.class !== "etf" && (
                  <UnderlyingExposure assetId={asset.id} isEtf={false} hidden={hidden} />
                )}
                <PositionDividends assetId={asset.id} asset={asset} hidden={hidden} />
                <OpenLots lots={pos.lots} hidden={hidden} />
              </>
            )}

            <TransactionHistory
              transactions={pos.transactions}
              isMetal={isMetal}
              hidden={hidden}
              onChanged={refresh}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
