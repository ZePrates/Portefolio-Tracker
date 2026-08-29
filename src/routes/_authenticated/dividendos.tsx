import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listAssets, listDividends, createDividend, deleteDividend } from "@/lib/portfolio.functions";
import { type Asset, type Dividend, assetCurrentValue } from "@/lib/portfolio-types";
import { formatEUR, formatDatePt } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { PageHeader, MetricCard, EmptyState, Button, Modal, Field, TextInput } from "@/components/ui-bits";

export const Route = createFileRoute("/_authenticated/dividendos")({
  head: () => ({
    meta: [
      { title: "Dividendos — Portefólio Tracker" },
      { name: "description", content: "Acompanha os rendimentos passivos do teu portefólio: recebidos, projeção anual e histórico." },
      { property: "og:title", content: "Dividendos — Portefólio Tracker" },
      { property: "og:description", content: "Acompanha os rendimentos passivos do teu portefólio." },
    ],
  }),
  component: DividendosPage,
});

function DividendosPage() {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const fetchAssets = useServerFn(listAssets);
  const fetchDividends = useServerFn(listDividends);
  const createFn = useServerFn(createDividend);
  const deleteFn = useServerFn(deleteDividend);

  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const { data: assetsRaw } = useQuery({ queryKey: ["assets"], queryFn: () => fetchAssets() });
  const { data: dividendsRaw, isLoading } = useQuery({
    queryKey: ["dividends"],
    queryFn: () => fetchDividends(),
  });

  const assets = (assetsRaw ?? []) as Asset[];
  const dividends = (dividendsRaw ?? []) as Dividend[];

  const year = new Date().getFullYear();
  const receivedYear = dividends
    .filter((d) => new Date(d.paid_at).getFullYear() === year)
    .reduce((s, d) => s + d.amount, 0);
  const totalHistoric = dividends.reduce((s, d) => s + d.amount, 0);
  const projection = assets.reduce((s, a) => {
    if (!a.annual_yield) return s;
    return s + (assetCurrentValue(a) * a.annual_yield) / 100;
  }, 0);
  const monthlyAvg = projection / 12;

  const save = async () => {
    const value = parseFloat(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Indica um valor válido.");
      return;
    }
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) {
      toast.error("Escolhe o ativo que pagou o dividendo.");
      return;
    }
    setSaving(true);
    try {
      await createFn({
        data: { asset_id: asset.id, asset_name: asset.name, amount: value, paid_at: date },
      });
      toast.success("Dividendo registado.");
      setOpen(false);
      setAmount("");
      await queryClient.invalidateQueries({ queryKey: ["dividends"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao registar.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: Dividend) => {
    if (!window.confirm("Eliminar este registo de dividendo?")) return;
    try {
      await deleteFn({ data: { id: d.id } });
      await queryClient.invalidateQueries({ queryKey: ["dividends"] });
      toast.success("Registo eliminado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao eliminar.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dividendos"
        subtitle="Acompanhe os rendimentos passivos do seu portefólio."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Registar dividendo
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <MetricCard label={`Recebidos em ${year}`} value={formatEUR(receivedYear, hidden)} />
        <MetricCard
          label="Projeção anual"
          value={formatEUR(projection, hidden)}
          sub="Com base no yield atual"
        />
        <MetricCard label="Média mensal projetada" value={formatEUR(monthlyAvg, hidden)} />
        <MetricCard label="Total histórico" value={formatEUR(totalHistoric, hidden)} />
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          A carregar…
        </div>
      ) : dividends.length === 0 ? (
        <EmptyState
          title="Ainda sem dividendos registados"
          description="Regista o primeiro dividendo para começar a acompanhar os teus rendimentos passivos."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              Registar dividendo
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Ativo</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {dividends.map((d) => (
                <tr key={d.id} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3 text-muted-foreground">{formatDatePt(d.paid_at)}</td>
                  <td className="px-4 py-3 font-medium">{d.asset_name}</td>
                  <td className="px-4 py-3 text-right font-medium text-success">
                    {formatEUR(d.amount, hidden)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <button
                        onClick={() => remove(d)}
                        className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                        aria-label="Eliminar registo"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Registar dividendo">
        <div className="space-y-4">
          <Field label="Ativo">
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            >
              <option value="">Escolher ativo…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor (€)">
              <TextInput
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </Field>
            <Field label="Data de pagamento">
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "A guardar…" : "Registar"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
