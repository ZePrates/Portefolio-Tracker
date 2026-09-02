import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { Asset, Dividend } from "@/lib/portfolio-types";
import { buyAsset, getPosition, previewSale, sellAsset, listDividends } from "@/lib/portfolio.functions";
import { grossOf, isReceived, lastDividend, nextDividend, totalReceived, totalScheduled } from "@/lib/dividends";
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

            {mode === "view" ? (
              <div className="flex gap-2">
                <Button onClick={() => setMode("buy")}>Comprar</Button>
                <Button
                  variant="outline"
                  onClick={() => setMode("sell")}
                  disabled={pos.quantity <= 0}
                >
                  Vender
                </Button>
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
                    <Row label="Quantidade disponível" value={String(Number(preview.available.toFixed(6)))} />
                    <Row label="Quantidade a vender" value={String(num(quantity))} />
                    <Row label={`Preço de venda (${currency})`} value={formatMoney(num(price), currency, hidden)} />
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
                        .map((b) => `${Number(b.quantity.toFixed(4))} @ ${formatEUR(b.unitCost, hidden)} (${b.traded_at})`)
                        .join(" · ")}
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setMode("view")}>
                    Cancelar
                  </Button>
                  <Button onClick={confirm} disabled={saving || (mode === "sell" && !preview)}>
                    {saving ? "A registar…" : mode === "buy" ? "Confirmar compra" : "Confirmar venda"}
                  </Button>
                </div>
              </div>
            )}

            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Dividendos
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Recebidos</div>
                  <div className="font-medium text-success">{formatEUR(divStats.received, hidden)}</div>
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
                <p className="text-sm text-muted-foreground">Sem lotes abertos — posição fechada.</p>
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
                          <td className="px-3 py-2 text-right">{Number(l.originalQuantity.toFixed(6))}</td>
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
                      {pos.transactions.map((t) => (
                        <tr key={t.id} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2">{t.traded_at}</td>
                          <td className="px-3 py-2">{t.type === "buy" ? "Compra" : "Venda"}</td>
                          <td className="px-3 py-2 text-right">{Number(Number(t.quantity).toFixed(6))}</td>
                          <td className="px-3 py-2 text-right">{formatEUR(Number(t.price), hidden)}</td>
                          <td className="px-3 py-2 text-right">{formatEUR(Number(t.fee ?? 0), hidden)}</td>
                          <td className={cn("px-3 py-2 text-right", t.realized_pl != null && tone(Number(t.realized_pl)))}>
                            {t.realized_pl != null ? formatEUR(Number(t.realized_pl), hidden) : "—"}
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
