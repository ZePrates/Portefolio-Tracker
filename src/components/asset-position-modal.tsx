import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Asset, Dividend } from "@/lib/portfolio-types";
import {
  buyAsset,
  getPosition,
  previewSale,
  sellAsset,
  listDividends,
  updateTransaction,
  deleteTransaction,
} from "@/lib/portfolio.functions";
import { createExpense, deleteExpense, listExpenses } from "@/lib/expenses.functions";
import { splitMetalPurchase, type MetalSummary } from "@/lib/metals";
import { MetalPositionPanel, type MetalExpenseRow } from "@/components/metal-position-panel";
import { getAssetExposure, syncAssetExposure } from "@/lib/exposure.functions";
import {
  grossOf,
  isReceived,
  lastDividend,
  nextDividend,
  totalReceived,
  totalScheduled,
} from "@/lib/dividends";
import {
  formatDatePt,
  formatEUR,
  formatMoney,
  formatNumber,
  formatPct,
  formatQuantity,
  parseNumberOr,
} from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { Button, Field, Modal, TextInput, useConfirm } from "@/components/ui-bits";
import { validateExpenseAmount, validateTradeForm } from "@/lib/trade-form";
import { cn } from "@/lib/utils";
import { todayLisbon } from "@/lib/dates";
import { EtfPositionSheet } from "@/components/etf-position-sheet";
import { ExposureTable } from "@/components/exposure-table";
import { HoldingsStatus } from "@/components/etf-coverage";
import {
  exposureCountry,
  exposureEUR,
  exposurePct,
  exposureSector,
  mergeDisplayDimensions,
  readableCompanyName,
} from "@/lib/exposure-display";
import { syncManagerHoldings, syncSummaryText } from "@/lib/holdings-sync";

interface Props {
  asset: Asset | null;
  onClose: () => void;
}

interface Lot {
  id?: string;
  originalQuantity: number;
  quantity: number;
  unitCost: number;
  traded_at: string;
}

interface Tx {
  id: string;
  type: string;
  quantity: number;
  price: number;
  total: number;
  fee: number;
  traded_at: string;
  realized_pl: number | null;
  price_native: number | null;
  native_currency: string;
}

interface Preview {
  available: number;
  proceeds: number;
  fee: number;
  costBasis: number;
  realizedPL: number;
  remainingQuantity: number;
  breakdown: { lotId?: string; traded_at: string; quantity: number; unitCost: number }[];
}

function num(s: string): number {
  return parseNumberOr(s, 0);
}

const today = () => todayLisbon();

export function AssetPositionModal({ asset, onClose }: Props) {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const askConfirm = useConfirm();
  const positionFn = useServerFn(getPosition);
  const previewFn = useServerFn(previewSale);
  const buyFn = useServerFn(buyAsset);
  const sellFn = useServerFn(sellAsset);
  const expensesFn = useServerFn(listExpenses);
  const createExpenseFn = useServerFn(createExpense);
  const deleteExpenseFn = useServerFn(deleteExpense);
  const updateTxFn = useServerFn(updateTransaction);
  const deleteTxFn = useServerFn(deleteTransaction);

  const [mode, setMode] = useState<"view" | "buy" | "sell" | "expense">("view");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");
  // Metais: taxa paga em gramas e compra introduzida como no extrato da custódia.
  const [expenseGrams, setExpenseGrams] = useState("");
  const [expensePerGram, setExpensePerGram] = useState("");
  const [metalPaid, setMetalPaid] = useState("");
  const [metalPremium, setMetalPremium] = useState("");

  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [date, setDate] = useState(today);
  const [editingTx, setEditingTx] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editFee, setEditFee] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currency = asset?.native_currency || "EUR";

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));
  const tradeErrors = useMemo(
    () => validateTradeForm({ quantity, price, fee, date }, today()),
    [quantity, price, fee, date],
  );
  const editErrors = useMemo(
    () =>
      validateTradeForm(
        { quantity: editQuantity, price: editPrice, fee: editFee, date: editDate },
        today(),
      ),
    [editQuantity, editPrice, editFee, editDate],
  );
  const expenseError = useMemo(() => validateExpenseAmount(expenseAmount), [expenseAmount]);
  const tradeErr = (k: "quantity" | "price" | "fee" | "date") =>
    touched["trade_" + k] ? tradeErrors[k] : undefined;

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

  const dividendsFn = useServerFn(listDividends);
  const { data: allDividends } = useQuery({
    queryKey: ["dividends"],
    queryFn: () => dividendsFn(),
    enabled: !!asset,
  });

  const assetDividends = useMemo(
    () =>
      ((allDividends ?? []) as Dividend[])
        .filter((d) => d.asset_id === asset?.id)
        .sort((a, b) => (b.payment_date ?? b.paid_at).localeCompare(a.payment_date ?? a.paid_at)),
    [allDividends, asset?.id],
  );

  const divStats = useMemo(() => {
    const rows = assetDividends as never[];
    return {
      received: totalReceived(rows),
      scheduled: totalScheduled(rows),
      last: lastDividend(rows) as (Dividend & { payment_date?: string | null }) | null,
      next: nextDividend(rows) as (Dividend & { payment_date?: string | null }) | null,
    };
  }, [assetDividends]);

  useEffect(() => {
    if (!asset) return;
    setMode("view");
    setQuantity("");
    setPrice(String(asset.current_price_native ?? asset.current_price ?? "").replace(".", ","));
    setFee("");
    setDate(today());
    setPreview(null);
    setPreviewError(null);
  }, [asset?.id]);

  // Pré-visualização em tempo real da venda
  useEffect(() => {
    if (mode !== "sell" || !asset) return;
    const q = num(quantity);
    if (q <= 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = (await previewFn({
          data: {
            assetId: asset.id,
            quantity: q,
            price_native: num(price),
            fee_native: num(fee),
            traded_at: date,
          },
        })) as Preview;
        if (!cancelled) {
          setPreview(res);
          setPreviewError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : "Venda inválida.");
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mode, quantity, price, fee, date, asset?.id]);

  if (!asset) return null;

  const pos = data as
    | {
        lots: Lot[];
        transactions: Tx[];
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
    await queryClient.invalidateQueries({ queryKey: ["assets"] });
    await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    await queryClient.invalidateQueries({ queryKey: ["portfolio-snapshots"] });
    await queryClient.invalidateQueries({ queryKey: ["position", asset.id] });
  };

  /** Compra de metal tal como aparece no extrato: valor pago, gramas e ágio. */
  const metalSplit = (() => {
    try {
      return splitMetalPurchase(num(metalPaid), num(quantity), num(metalPremium) / 100);
    } catch (e) {
      return e instanceof Error ? e.message : "Dados inválidos.";
    }
  })();

  const confirmMetalBuy = async () => {
    if (typeof metalSplit === "string") {
      toast.error(metalSplit);
      return;
    }
    if (!date || date > today()) {
      toast.error("Data inválida.");
      return;
    }
    setSaving(true);
    try {
      await buyFn({
        data: {
          assetId: asset.id,
          quantity: num(quantity),
          price_native: metalSplit.spot,
          fee_native: metalSplit.premium,
          premium_rate: num(metalPremium) / 100,
          traded_at: date,
          notes: null,
        },
      });
      toast.success("Compra registada.");
      setMode("view");
      setQuantity("");
      setMetalPaid("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Operação falhou.");
    } finally {
      setSaving(false);
    }
  };

  const confirm = async () => {
    if (isMetal && mode === "buy") return confirmMetalBuy();
    const q = num(quantity);
    setTouched((t) => ({
      ...t,
      trade_quantity: true,
      trade_price: true,
      trade_fee: true,
      trade_date: true,
    }));
    if (Object.keys(tradeErrors).length > 0) return;
    setSaving(true);
    try {
      const payload = {
        assetId: asset.id,
        quantity: q,
        price_native: num(price),
        fee_native: num(fee),
        traded_at: date,
        notes: null,
      };
      if (mode === "buy") {
        await buyFn({ data: payload });
        toast.success("Compra registada.");
      } else {
        const res = (await sellFn({ data: payload })) as { realizedPL: number; closed: boolean };
        toast.success(
          `Venda registada. ${res.realizedPL >= 0 ? "Lucro" : "Prejuízo"} realizado: ${formatEUR(res.realizedPL, false)}${res.closed ? " · posição fechada" : ""}`,
        );
      }
      setMode("view");
      setQuantity("");
      setFee("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Operação falhou.");
    } finally {
      setSaving(false);
    }
  };

  const saveExpense = async () => {
    const v = num(expenseAmount);
    const g = num(expenseGrams);
    const ppg = num(expensePerGram);
    setTouched((t) => ({ ...t, expense_amount: true }));
    if (expenseError) return;
    if (g < 0) {
      toast.error("Os gramas não podem ser negativos.");
      return;
    }
    setSaving(true);
    try {
      await createExpenseFn({
        data: {
          assetId: asset.id,
          type: "storage",
          amount: v,
          currency: "EUR",
          fx_rate: 1,
          incurred_at: date,
          notes: expenseNotes || null,
          grams_deducted: g,
          price_per_gram: g > 0 ? (ppg > 0 ? ppg : v / g) : null,
        },
      });
      toast.success(g > 0 ? "Taxa registada e gramas deduzidos." : "Despesa registada.");
      setExpenseAmount("");
      setExpenseNotes("");
      setExpenseGrams("");
      setExpensePerGram("");
      setMode("view");
      await queryClient.invalidateQueries({ queryKey: ["expenses", asset.id] });
      if (g > 0) await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registar a despesa.");
    } finally {
      setSaving(false);
    }
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
    setSaving(true);
    try {
      await deleteExpenseFn({ data: { id: e.id } });
      toast.success("Taxa apagada.");
      await queryClient.invalidateQueries({ queryKey: ["expenses", asset.id] });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível apagar a taxa.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (t: Tx) => {
    setEditingTx(t.id);
    setEditDate(t.traded_at);
    setEditQuantity(String(Number(Number(t.quantity).toFixed(6))));
    setEditPrice(String(t.price_native ?? t.price));
    setEditFee(String(Number(t.fee ?? 0)));
  };

  const saveTx = async () => {
    if (!editingTx) return;
    const q = num(editQuantity);
    setTouched((t) => ({
      ...t,
      edit_quantity: true,
      edit_price: true,
      edit_fee: true,
      edit_date: true,
    }));
    if (Object.keys(editErrors).length > 0) return;
    setSaving(true);
    try {
      await updateTxFn({
        data: {
          id: editingTx,
          quantity: q,
          price_native: num(editPrice),
          fee_native: num(editFee),
          traded_at: editDate,
        },
      });
      toast.success("Movimento atualizado.");
      setEditingTx(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar o movimento.");
    } finally {
      setSaving(false);
    }
  };

  const removeTx = async (t: Tx) => {
    const ok = await askConfirm({
      title: `Apagar o movimento de ${formatDatePt(t.traded_at)}?`,
      description: "A posição e o custo FIFO são recalculados sem este movimento.",
      confirmLabel: "Apagar",
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteTxFn({ data: { id: t.id } });
      toast.success("Movimento apagado.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível apagar o movimento.");
    } finally {
      setSaving(false);
    }
  };

  const tone = (v: number) =>
    v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground";

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
                <Stat label="Custo (FIFO)" value={formatEUR(pos.costBasis, hidden)} />
                <Stat
                  label="P/L não realizado"
                  value={formatEUR(pos.unrealizedPL, hidden)}
                  className={tone(pos.unrealizedPL)}
                />
                <Stat
                  label="P/L realizado"
                  value={formatEUR(pos.realizedPL, hidden)}
                  className={tone(pos.realizedPL)}
                />
              </div>
            )}
            {metal && pos.realizedPL !== 0 && (
              <p className="text-xs text-muted-foreground">
                P/L realizado em vendas: {formatEUR(pos.realizedPL, hidden)}
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

            {mode === "view" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    if (isMetal && lastPremium != null && metalPremium === "")
                      setMetalPremium(formatNumber(lastPremium * 100, 2));
                    setMode("buy");
                  }}
                >
                  Comprar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setMode("sell")}
                  disabled={pos.quantity <= 0}
                >
                  Vender
                </Button>
                {isMetal && (
                  <Button variant="outline" onClick={() => setMode("expense")}>
                    Taxa de armazenamento
                  </Button>
                )}
              </div>
            ) : mode === "expense" ? (
              <div className="space-y-3 rounded-xl border border-border bg-background/50 p-4">
                <p className="text-sm font-medium">Nova taxa de armazenamento</p>
                <p className="text-xs text-muted-foreground">
                  Se a custódia cobra em metal (ex.: Elementum), indica os gramas deduzidos: saem do
                  cofre sem contar como venda. Paga em dinheiro: deixa os gramas a 0.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Gramas deduzidos">
                    <TextInput
                      inputMode="decimal"
                      value={expenseGrams}
                      onChange={(e) => setExpenseGrams(e.target.value)}
                      placeholder="0,00"
                    />
                  </Field>
                  <Field label="Preço por grama (EUR)" hint="Do extrato; opcional">
                    <TextInput
                      inputMode="decimal"
                      value={expensePerGram}
                      onChange={(e) => setExpensePerGram(e.target.value)}
                      placeholder="0,0000"
                    />
                  </Field>
                  <Field
                    label="Valor faturado (EUR)"
                    error={touched["expense_amount"] ? expenseError : undefined}
                  >
                    <TextInput
                      inputMode="decimal"
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      onBlur={touch("expense_amount")}
                      placeholder="0,00"
                    />
                  </Field>
                  <Field label="Data">
                    <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                  <Field label="Notas">
                    <TextInput
                      value={expenseNotes}
                      onChange={(e) => setExpenseNotes(e.target.value)}
                      placeholder="Ex.: cofre anual"
                    />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Button onClick={saveExpense} disabled={saving}>
                    Registar taxa
                  </Button>
                  <Button variant="outline" onClick={() => setMode("view")}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-border bg-background/50 p-4">
                <p className="text-sm font-medium">
                  {mode === "buy" ? "Nova compra" : "Nova venda"}
                  {mode === "sell" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      disponível: {formatQuantity(pos.quantity)}
                    </span>
                  )}
                </p>
                {isMetal && mode === "buy" ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Valor pago (EUR)">
                        <TextInput
                          inputMode="decimal"
                          value={metalPaid}
                          onChange={(e) => setMetalPaid(e.target.value)}
                          placeholder="0,00"
                        />
                      </Field>
                      <Field label="Gramas recebidos">
                        <TextInput
                          inputMode="decimal"
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                          placeholder="0,00"
                        />
                      </Field>
                      <Field label="Ágio (%)" hint="Prémio sobre o spot, do extrato">
                        <TextInput
                          inputMode="decimal"
                          value={metalPremium}
                          onChange={(e) => setMetalPremium(e.target.value)}
                          placeholder="8,75"
                        />
                      </Field>
                      <Field label="Data">
                        <TextInput
                          type="date"
                          value={date}
                          max={today()}
                          onChange={(e) => setDate(e.target.value)}
                        />
                      </Field>
                    </div>
                    {typeof metalSplit !== "string" && (
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(metalSplit.paidPerGram, 4)} €/g pago = spot{" "}
                        {formatNumber(metalSplit.spot, 4)} €/g + ágio{" "}
                        {formatEUR(metalSplit.premium, hidden)}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={isMetal ? "Gramas" : "Quantidade"} error={tradeErr("quantity")}>
                      <TextInput
                        inputMode="decimal"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        onBlur={touch("trade_quantity")}
                        placeholder="0"
                      />
                    </Field>
                    <Field
                      label={
                        isMetal
                          ? "Preço de recompra por grama (EUR)"
                          : `Preço por unidade (${currency})`
                      }
                      error={tradeErr("price")}
                    >
                      <TextInput
                        inputMode="decimal"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        onBlur={touch("trade_price")}
                        placeholder="0,00"
                      />
                    </Field>
                    <Field label={`Comissão (${currency})`} error={tradeErr("fee")}>
                      <TextInput
                        inputMode="decimal"
                        value={fee}
                        onChange={(e) => setFee(e.target.value)}
                        onBlur={touch("trade_fee")}
                        placeholder="0,00"
                      />
                    </Field>
                    <Field label="Data" error={tradeErr("date")}>
                      <TextInput
                        type="date"
                        value={date}
                        max={today()}
                        onChange={(e) => setDate(e.target.value)}
                        onBlur={touch("trade_date")}
                      />
                    </Field>
                  </div>
                )}

                {mode === "sell" && previewError && (
                  <p className="text-sm text-destructive">{previewError}</p>
                )}

                {mode === "sell" && preview && (
                  <div className="space-y-1 rounded-lg border border-border bg-card p-3 text-sm">
                    <Row
                      label="Quantidade disponível"
                      value={String(Number(preview.available.toFixed(6)))}
                    />
                    <Row label="Quantidade a vender" value={String(num(quantity))} />
                    <Row
                      label={`Preço de venda (${currency})`}
                      value={formatMoney(num(price), currency, hidden)}
                    />
                    <Row label="Receita bruta" value={formatEUR(preview.proceeds, hidden)} />
                    <Row label="Custo (FIFO)" value={formatEUR(preview.costBasis, hidden)} />
                    <Row label="Comissão" value={formatEUR(preview.fee, hidden)} />
                    <Row
                      label="Lucro/prejuízo realizado"
                      value={formatEUR(preview.realizedPL, hidden)}
                      className={tone(preview.realizedPL)}
                    />
                    <Row
                      label="Quantidade restante"
                      value={String(Number(preview.remainingQuantity.toFixed(6)))}
                    />
                    <p className="pt-1 text-xs text-muted-foreground">
                      Lotes consumidos:{" "}
                      {preview.breakdown
                        .map(
                          (b) =>
                            `${formatQuantity(b.quantity, 4)} @ ${formatEUR(b.unitCost, hidden)} (${formatDatePt(b.traded_at)})`,
                        )
                        .join(" · ")}
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setMode("view")}>
                    Cancelar
                  </Button>
                  <Button onClick={confirm} disabled={saving || (mode === "sell" && !preview)}>
                    {saving
                      ? "A registar…"
                      : mode === "buy"
                        ? "Confirmar compra"
                        : "Confirmar venda"}
                  </Button>
                </div>
              </div>
            )}

            {!isMetal && (
              <>
                {asset.class !== "etf" && (
                  <UnderlyingExposure assetId={asset.id} isEtf={false} hidden={hidden} />
                )}

                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Dividendos
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div className="rounded-lg border border-border p-3">
                      <div className="text-xs text-muted-foreground">Recebidos</div>
                      <div className="font-medium text-success">
                        {formatEUR(divStats.received, hidden)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <div className="text-xs text-muted-foreground">Previstos</div>
                      <div className="font-medium">{formatEUR(divStats.scheduled, hidden)}</div>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <div className="text-xs text-muted-foreground">Último</div>
                      <div className="font-medium">
                        {divStats.last
                          ? `${formatEUR(grossOf(divStats.last), hidden)} · ${divStats.last.payment_date ?? divStats.last.paid_at}`
                          : "—"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <div className="text-xs text-muted-foreground">Próximo</div>
                      <div className="font-medium">
                        {divStats.next
                          ? `${formatEUR(grossOf(divStats.next), hidden)} · ${divStats.next.payment_date ?? divStats.next.paid_at}`
                          : "—"}
                      </div>
                    </div>
                  </div>
                  {assetDividends.length > 0 && (
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                      {assetDividends.map((d) => (
                        <li key={d.id} className="flex justify-between">
                          <span>{d.payment_date ?? d.paid_at}</span>
                          <span>
                            {formatEUR(grossOf(d as never), hidden)}{" "}
                            {isReceived(d as never) ? "" : "(previsto)"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Lotes abertos
                  </h3>
                  {pos.lots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Sem lotes abertos — posição fechada.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead className="text-xs uppercase text-muted-foreground">
                          <tr className="border-b border-border text-left">
                            <th className="px-3 py-2 font-medium">Data</th>
                            <th className="px-3 py-2 text-right font-medium">Original</th>
                            <th className="px-3 py-2 text-right font-medium">Restante</th>
                            <th className="px-3 py-2 text-right font-medium">Custo/un.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pos.lots.map((l, i) => (
                            <tr key={l.id ?? i} className="border-b border-border/60 last:border-0">
                              <td className="px-3 py-2">{formatDatePt(l.traded_at)}</td>
                              <td className="px-3 py-2 text-right">
                                {formatQuantity(l.originalQuantity)}
                              </td>
                              <td className="px-3 py-2 text-right">{formatQuantity(l.quantity)}</td>
                              <td className="px-3 py-2 text-right">
                                {formatEUR(l.unitCost, hidden)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}

            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Histórico de movimentos
              </h3>
              {pos.transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem movimentos registados.</p>
              ) : (
                <div className="max-h-64 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-popover text-xs uppercase text-muted-foreground">
                      <tr className="border-b border-border text-left">
                        <th className="px-3 py-2 font-medium">Data</th>
                        <th className="px-3 py-2 font-medium">Tipo</th>
                        <th className="px-3 py-2 text-right font-medium">Qtd.</th>
                        <th className="px-3 py-2 text-right font-medium">
                          {isMetal ? "Spot/g" : "Preço"}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {isMetal ? "Ágio" : "Comissão"}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">Realizado</th>
                        <th className="px-3 py-2 text-right font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pos.transactions.map((t) =>
                        editingTx === t.id ? (
                          <tr key={t.id} className="border-b border-border/60 last:border-0">
                            <td className="px-3 py-2">
                              <TextInput
                                type="date"
                                value={editDate}
                                onChange={(e) => {
                                  setEditDate(e.target.value);
                                  setTouched((t) => ({ ...t, edit_date: true }));
                                }}
                                aria-invalid={
                                  touched["edit_date"] && editErrors.date ? true : undefined
                                }
                                title={touched["edit_date"] ? editErrors.date : undefined}
                              />
                            </td>
                            <td className="px-3 py-2">{t.type === "buy" ? "Compra" : "Venda"}</td>
                            <td className="px-3 py-2">
                              <TextInput
                                inputMode="decimal"
                                value={editQuantity}
                                onChange={(e) => {
                                  setEditQuantity(e.target.value);
                                  setTouched((t) => ({ ...t, edit_quantity: true }));
                                }}
                                aria-invalid={
                                  touched["edit_quantity"] && editErrors.quantity ? true : undefined
                                }
                                title={touched["edit_quantity"] ? editErrors.quantity : undefined}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <TextInput
                                inputMode="decimal"
                                value={editPrice}
                                onChange={(e) => {
                                  setEditPrice(e.target.value);
                                  setTouched((t) => ({ ...t, edit_price: true }));
                                }}
                                aria-invalid={
                                  touched["edit_price"] && editErrors.price ? true : undefined
                                }
                                title={touched["edit_price"] ? editErrors.price : undefined}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <TextInput
                                inputMode="decimal"
                                value={editFee}
                                onChange={(e) => {
                                  setEditFee(e.target.value);
                                  setTouched((t) => ({ ...t, edit_fee: true }));
                                }}
                                aria-invalid={
                                  touched["edit_fee"] && editErrors.fee ? true : undefined
                                }
                                title={touched["edit_fee"] ? editErrors.fee : undefined}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-2">
                                <Button onClick={saveTx} disabled={saving}>
                                  Guardar
                                </Button>
                                <Button variant="outline" onClick={() => setEditingTx(null)}>
                                  Cancelar
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr key={t.id} className="border-b border-border/60 last:border-0">
                            <td className="px-3 py-2">{formatDatePt(t.traded_at)}</td>
                            <td className="px-3 py-2">{t.type === "buy" ? "Compra" : "Venda"}</td>
                            <td className="px-3 py-2 text-right">
                              {formatQuantity(Number(t.quantity))}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatEUR(Number(t.price), hidden)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatEUR(Number(t.fee ?? 0), hidden)}
                            </td>
                            <td
                              className={cn(
                                "px-3 py-2 text-right",
                                t.realized_pl != null && tone(Number(t.realized_pl)),
                              )}
                            >
                              {t.realized_pl != null
                                ? formatEUR(Number(t.realized_pl), hidden)
                                : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  aria-label="Editar movimento"
                                  title="Editar"
                                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-active hover:text-primary"
                                  onClick={() => startEdit(t)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Apagar movimento"
                                  title="Apagar"
                                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                                  onClick={() => removeTx(t)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-medium", className)}>{value}</p>
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", className)}>{value}</span>
    </div>
  );
}

/** Exposição subjacente do ativo — lê a mesma fonte persistida da página Exposição. */
function UnderlyingExposure({
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
              hidden={hidden}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Cobertura: {exposurePct(d.coverage, hidden)} · {formatDatePt(d.asOfDate)} ·{" "}
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
                value={
                  d.profile.dividendYield == null
                    ? "—"
                    : exposurePct(d.profile.dividendYield, hidden)
                }
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
                  <span className="num whitespace-nowrap">{exposurePct(x.pct, hidden)}</span>
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
                  cell: (h) => exposureEUR(h.amount, hidden),
                },
                {
                  id: "pct",
                  label: "Peso",
                  numeric: true,
                  value: (h) => h.pct,
                  cell: (h) => exposurePct(h.pct, hidden),
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
