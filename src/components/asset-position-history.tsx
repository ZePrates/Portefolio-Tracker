import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteTransaction, updateTransaction } from "@/lib/portfolio.functions";
import { formatDatePt, formatQuantity, parseNumberOr } from "@/lib/format";
import { Button, TextInput, useConfirm } from "@/components/ui-bits";
import { validateTradeForm } from "@/lib/trade-form";
import { cn } from "@/lib/utils";
import { todayLisbon } from "@/lib/dates";
import { privateEUR } from "@/components/private-value";
import { pnlTone as tone } from "@/lib/utils";

export interface PositionTx {
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

const num = (s: string) => parseNumberOr(s, 0);

/** Histórico de movimentos, com edição e apagar em linha. */
export function TransactionHistory({
  transactions,
  isMetal,
  hidden,
  onChanged,
}: {
  transactions: PositionTx[];
  isMetal: boolean;
  hidden: boolean;
  /** Depois de editar ou apagar (recalcular a carteira). */
  onChanged: () => Promise<void>;
}) {
  const askConfirm = useConfirm();
  const updateTxFn = useServerFn(updateTransaction);
  const deleteTxFn = useServerFn(deleteTransaction);
  const [editingTx, setEditingTx] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editFee, setEditFee] = useState("");
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const editErrors = useMemo(
    () =>
      validateTradeForm(
        { quantity: editQuantity, price: editPrice, fee: editFee, date: editDate },
        todayLisbon(),
      ),
    [editQuantity, editPrice, editFee, editDate],
  );

  const startEdit = (t: PositionTx) => {
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
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar o movimento.");
    } finally {
      setSaving(false);
    }
  };

  const removeTx = async (t: PositionTx) => {
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
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível apagar o movimento.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Histórico de movimentos
      </h3>
      {transactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem movimentos registados.</p>
      ) : (
        <div className="max-h-64 overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-popover text-xs uppercase text-muted-foreground">
              <tr className="border-b border-border text-left">
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 text-right font-medium">Qtd.</th>
                <th className="px-3 py-2 text-right font-medium">{isMetal ? "Spot/g" : "Preço"}</th>
                <th className="px-3 py-2 text-right font-medium">
                  {isMetal ? "Ágio" : "Comissão"}
                </th>
                <th className="px-3 py-2 text-right font-medium">Realizado</th>
                <th className="px-3 py-2 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) =>
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
                        aria-invalid={touched["edit_date"] && editErrors.date ? true : undefined}
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
                        aria-invalid={touched["edit_price"] && editErrors.price ? true : undefined}
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
                        aria-invalid={touched["edit_fee"] && editErrors.fee ? true : undefined}
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
                    <td className="px-3 py-2 text-right">{formatQuantity(Number(t.quantity))}</td>
                    <td className="px-3 py-2 text-right">{privateEUR(Number(t.price), hidden)}</td>
                    <td className="px-3 py-2 text-right">
                      {privateEUR(Number(t.fee ?? 0), hidden)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right",
                        t.realized_pl != null && tone(Number(t.realized_pl)),
                      )}
                    >
                      {t.realized_pl != null ? privateEUR(Number(t.realized_pl), hidden) : "—"}
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
  );
}
