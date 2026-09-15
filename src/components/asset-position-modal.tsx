import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { Asset, Dividend } from "@/lib/portfolio-types";
import {
  buyAsset,
  getPosition,
  previewSale,
  sellAsset,
  listDividends,
} from "@/lib/portfolio.functions";
import { createExpense, listExpenses } from "@/lib/expenses.functions";
import {
  getAssetExposure,
  syncAssetExposure,
  type AssetExposureDetail,
} from "@/lib/exposure.functions";
import {
  grossOf,
  isReceived,
  lastDividend,
  nextDividend,
  totalReceived,
  totalScheduled,
} from "@/lib/dividends";
import { formatEUR, formatMoney } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { Button, Field, Modal, TextInput } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

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

function num(s: string) {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const today = () => new Date().toISOString().slice(0, 10);

export function AssetPositionModal({ asset, onClose }: Props) {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const positionFn = useServerFn(getPosition);
  const previewFn = useServerFn(previewSale);
  const buyFn = useServerFn(buyAsset);
  const sellFn = useServerFn(sellAsset);
  const expensesFn = useServerFn(listExpenses);
  const createExpenseFn = useServerFn(createExpense);

  const [mode, setMode] = useState<"view" | "buy" | "sell" | "expense">("view");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");

  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [date, setDate] = useState(today);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currency = asset?.native_currency || "EUR";

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
  const expenses = (expenseRows ?? []) as {
    id: string;
    amount: number;
    incurred_at: string;
    notes: string | null;
  }[];
  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

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
    setPrice(String(asset.current_price_native ?? asset.current_price ?? ""));
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
  }, [mode, quantity, price, fee, asset?.id]);

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
      }
    | undefined;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["assets"] });
    await queryClient.invalidateQueries({ queryKey: ["position", asset.id] });
  };

  const confirm = async () => {
    const q = num(quantity);
    if (q <= 0) {
      toast.error("Indica a quantidade.");
      return;
    }
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
    if (v <= 0) {
      toast.error("Indica o valor da despesa.");
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
        },
      });
      toast.success("Despesa registada.");
      setExpenseAmount("");
      setExpenseNotes("");
      setMode("view");
      await queryClient.invalidateQueries({ queryKey: ["expenses", asset.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registar a despesa.");
    } finally {
      setSaving(false);
    }
  };

  const tone = (v: number) =>
    v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground";

  return (
    <Modal open={!!asset} onClose={onClose} title={asset.name}>
      <div className="space-y-5">
        {isLoading || !pos ? (
          <p className="text-sm text-muted-foreground">A carregar posição…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Quantidade" value={String(Number(pos.quantity.toFixed(6)))} />
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

            {(asset.price_source || asset.price_updated_at) && (
              <p className="text-xs text-muted-foreground">
                Preço: {asset.price_source ?? "manual"}
                {asset.price_updated_at
                  ? ` · atualizado em ${new Date(asset.price_updated_at).toLocaleString("pt-PT")}`
                  : ""}
                {asset.fx_rate && asset.native_currency !== "EUR"
                  ? ` · câmbio ${asset.native_currency}→EUR ${asset.fx_rate.toFixed(4)}`
                  : ""}
              </p>
            )}

            {isMetal && (
              <div className="rounded-xl border border-border bg-background/50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Custos de armazenamento</span>
                  <span className="font-medium">{formatEUR(expensesTotal, hidden)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Registados como despesa — não alteram a quantidade de metal detida.
                </p>
              </div>
            )}

            {mode === "view" ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setMode("buy")}>Comprar</Button>
                <Button
                  variant="outline"
                  onClick={() => setMode("sell")}
                  disabled={pos.quantity <= 0}
                >
                  Vender
                </Button>
                {isMetal && (
                  <Button variant="outline" onClick={() => setMode("expense")}>
                    Custo de armazenamento
                  </Button>
                )}
              </div>
            ) : mode === "expense" ? (
              <div className="space-y-3 rounded-xl border border-border bg-background/50 p-4">
                <p className="text-sm font-medium">Novo custo de armazenamento</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Valor (EUR)">
                    <TextInput
                      inputMode="decimal"
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
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
                    Registar despesa
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
                      disponível: {Number(pos.quantity.toFixed(6))}
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Quantidade">
                    <TextInput
                      inputMode="decimal"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field label={`Preço por unidade (${currency})`}>
                    <TextInput
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0,00"
                    />
                  </Field>
                  <Field label={`Comissão (${currency})`}>
                    <TextInput
                      inputMode="decimal"
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                      placeholder="0,00"
                    />
                  </Field>
                  <Field label="Data">
                    <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                </div>

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
                    <Row label="Cost basis (FIFO)" value={formatEUR(preview.costBasis, hidden)} />
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
                            `${Number(b.quantity.toFixed(4))} @ ${formatEUR(b.unitCost, hidden)} (${b.traded_at})`,
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

            <UnderlyingExposure assetId={asset.id} hidden={hidden} />

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
                          <td className="px-3 py-2">{l.traded_at}</td>
                          <td className="px-3 py-2 text-right">
                            {Number(l.originalQuantity.toFixed(6))}
                          </td>
                          <td className="px-3 py-2 text-right">{Number(l.quantity.toFixed(6))}</td>
                          <td className="px-3 py-2 text-right">{formatEUR(l.unitCost, hidden)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Histórico de movimentos
              </h3>
              {pos.transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem movimentos registados.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr className="border-b border-border text-left">
                        <th className="px-3 py-2 font-medium">Data</th>
                        <th className="px-3 py-2 font-medium">Tipo</th>
                        <th className="px-3 py-2 text-right font-medium">Qtd.</th>
                        <th className="px-3 py-2 text-right font-medium">Preço</th>
                        <th className="px-3 py-2 text-right font-medium">Comissão</th>
                        <th className="px-3 py-2 text-right font-medium">Realizado</th>
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
                                onChange={(e) => setEditDate(e.target.value)}
                              />
                            </td>
                            <td className="px-3 py-2">{t.type === "buy" ? "Compra" : "Venda"}</td>
                            <td className="px-3 py-2">
                              <TextInput
                                inputMode="decimal"
                                value={editQuantity}
                                onChange={(e) => setEditQuantity(e.target.value)}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <TextInput
                                inputMode="decimal"
                                value={editPrice}
                                onChange={(e) => setEditPrice(e.target.value)}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <TextInput
                                inputMode="decimal"
                                value={editFee}
                                onChange={(e) => setEditFee(e.target.value)}
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
                            <td className="px-3 py-2">{t.traded_at}</td>
                            <td className="px-3 py-2">{t.type === "buy" ? "Compra" : "Venda"}</td>
                            <td className="px-3 py-2 text-right">
                              {Number(Number(t.quantity).toFixed(6))}
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
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  className="text-xs text-primary hover:underline"
                                  onClick={() => startEdit(t)}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-destructive hover:underline"
                                  onClick={() => removeTx(t)}
                                >
                                  Apagar
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
function UnderlyingExposure({ assetId, hidden }: { assetId: string; hidden: boolean }) {
  const queryClient = useQueryClient();
  const fetchFn = useServerFn(getAssetExposure);
  const syncFn = useServerFn(syncAssetExposure);
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["asset-exposure", assetId],
    queryFn: () => fetchFn({ data: { assetId } }),
  });

  const sync = async () => {
    setSyncing(true);
    try {
      const res = (await syncFn({ data: { assetId } })) as { ok: boolean; message?: string };
      toast[res.ok ? "success" : "message"](
        res.ok
          ? "Composição atualizada."
          : (res.message ?? "Sem dados novos — dados anteriores preservados."),
      );
      await queryClient.invalidateQueries({ queryKey: ["asset-exposure", assetId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar a composição.");
    } finally {
      setSyncing(false);
    }
  };

  const d = data as AssetExposureDetail | undefined;
  const hasData = !!d && (d.holdings.length > 0 || d.dimensions.length > 0 || !!d.profile);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Exposição subjacente
        </h3>
        <Button variant="outline" onClick={sync} disabled={syncing}>
          {syncing ? "A sincronizar…" : "Atualizar composição"}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar composição…</p>
      ) : !hasData ? (
        <p className="text-sm text-muted-foreground">
          Dados não disponíveis. Usa “Atualizar composição” para consultar a fonte.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Cobertura conhecida: {d!.coverage.toFixed(1)}%
            {d!.asOfDate ? ` · dados de ${d!.asOfDate}` : ""}
            {d!.source ? ` · fonte ${d!.source}` : ""}
            {d!.history.length > 1 ? ` · histórico: ${d!.history.length} datas` : ""}
          </p>

          {d!.profile && (
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label="Tipo" value={d!.profile.assetType ?? "Não disponível"} />
              <Stat label="Moeda de cotação" value={d!.profile.currency ?? "Não disponível"} />
              <Stat label="Domicílio" value={d!.profile.domicile ?? "Não disponível"} />
              <Stat
                label="Yield"
                value={
                  d!.profile.dividendYield != null
                    ? `${d!.profile.dividendYield.toFixed(2)}%`
                    : "Não disponível"
                }
              />
            </div>
          )}

          {d!.dimensions.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {d!.dimensions.map((x, i) => (
                <li key={`${x.dimension}-${x.value}-${i}`} className="flex justify-between gap-4">
                  <span>
                    {DIM_LABELS[x.dimension] ?? x.dimension}: {x.value}
                  </span>
                  <span>{x.pct.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          )}

          {d!.holdings.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="border-b border-border text-left">
                    <th className="px-3 py-2 font-medium">Empresa</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">País</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Setor</th>
                    <th className="px-3 py-2 text-right font-medium">Peso</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {d!.holdings.map((h, i) => (
                    <tr
                      key={`${h.symbol ?? h.name}-${i}`}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-3 py-2">
                        {h.name}
                        {h.symbol ? (
                          <span className="ml-1 text-xs text-muted-foreground">{h.symbol}</span>
                        ) : null}
                      </td>
                      <td className="hidden px-3 py-2 sm:table-cell">
                        {h.country ?? "Não disponível"}
                      </td>
                      <td className="hidden px-3 py-2 sm:table-cell">
                        {h.sector ?? "Não disponível"}
                      </td>
                      <td className="px-3 py-2 text-right">{h.pct.toFixed(2)}%</td>
                      <td className="px-3 py-2 text-right">{formatEUR(h.amount, hidden)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
