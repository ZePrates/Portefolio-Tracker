import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  type Asset,
  type AssetClass,
  assetCurrentValue,
  assetInvested,
  assetPL,
} from "@/lib/portfolio-types";
import { listAssets, createAsset, updateAsset, deleteAsset } from "@/lib/portfolio.functions";
import { formatEUR, formatPercent } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { PageHeader, MetricCard, EmptyState, Button, Modal, Field, TextInput } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

interface Props {
  assetClass: AssetClass;
  title: string;
  subtitle: string;
  emptyLabel?: string;
}

interface FormState {
  name: string;
  ticker: string;
  quantity: string;
  average_price: string;
  current_price: string;
  invested_amount: string;
  current_value: string;
  metal_type: string;
  p2p_group: string;
  annual_yield: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  ticker: "",
  quantity: "",
  average_price: "",
  current_price: "",
  invested_amount: "",
  current_value: "",
  metal_type: "Ouro",
  p2p_group: "A",
  annual_yield: "",
};

function num(s: string): number {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function isSecurity(c: AssetClass) {
  return c === "etf" || c === "reit" || c === "acao_dividendo" || c === "acao_crescimento";
}

export function AssetClassPage({ assetClass, title, subtitle, emptyLabel }: Props) {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const fetchAssets = useServerFn(listAssets);
  const createFn = useServerFn(createAsset);
  const updateFn = useServerFn(updateAsset);
  const deleteFn = useServerFn(deleteAsset);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const { data: allAssets, isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetchAssets(),
  });

  const assets = ((allAssets ?? []) as Asset[]).filter((a) => a.class === assetClass);

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

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (a: Asset) => {
    setEditing(a);
    setForm({
      name: a.name,
      ticker: a.ticker ?? "",
      quantity: a.quantity ? String(a.quantity) : "",
      average_price: a.average_price ? String(a.average_price) : "",
      current_price: a.current_price ? String(a.current_price) : "",
      invested_amount: a.invested_amount ? String(a.invested_amount) : "",
      current_value: a.current_value ? String(a.current_value) : "",
      metal_type: a.metal_type ?? "Ouro",
      p2p_group: a.p2p_group ?? "A",
      annual_yield: a.annual_yield != null ? String(a.annual_yield) : "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Indica o nome do ativo.");
      return;
    }
    setSaving(true);
    try {
      const quantity = num(form.quantity);
      const averagePrice = num(form.average_price);
      const currentPrice = num(form.current_price);
      const invested = isSecurity(assetClass)
        ? quantity * averagePrice
        : num(form.invested_amount);
      const current = isSecurity(assetClass)
        ? quantity * currentPrice
        : num(form.current_value);
      const payload = {
        class: assetClass,
        name: form.name.trim(),
        ticker: form.ticker.trim() || null,
        quantity,
        average_price: averagePrice,
        current_price: currentPrice,
        invested_amount: invested,
        current_value: current,
        currency: "EUR",
        metal_type: assetClass === "metal" ? form.metal_type : null,
        p2p_group: assetClass === "p2p" ? form.p2p_group : null,
        annual_yield: form.annual_yield ? num(form.annual_yield) : null,
      };
      if (editing) {
        await updateFn({ data: { id: editing.id, patch: payload } });
        toast.success("Ativo atualizado.");
      } else {
        await createFn({ data: payload });
        toast.success("Ativo adicionado.");
      }
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao guardar.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: Asset) => {
    if (!window.confirm(`Eliminar "${a.name}"?`)) return;
    try {
      await deleteFn({ data: { id: a.id } });
      toast.success("Ativo eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao eliminar.");
    }
  };

  const refreshPrices = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const toastId = toast.loading("A obter preços do Yahoo Finance...");
    try {
      const res = (await refreshFn({ data: { class: assetClass } })) as {
        updated: number;
        failed: string[];
        total: number;
      };
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      if (res.updated === 0 && res.total === 0) {
        toast.info("Não há ativos com ticker nesta página.", { id: toastId });
      } else if (res.failed.length > 0) {
        toast.warning(
          `${res.updated} preços atualizados. Sem cotação: ${res.failed.join(", ")}`,
          { id: toastId },
        );
      } else {
        toast.success(`${res.updated} preços atualizados.`, { id: toastId });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar preços.", { id: toastId });
    } finally {
      setRefreshing(false);
    }
  };

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <Button variant="outline" onClick={refreshPrices}>
              <RefreshCw className="h-4 w-4" />
              Atualizar preços
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <MetricCard label="Valor atual" value={formatEUR(totals.current, hidden)} />
        <MetricCard label="Total investido" value={formatEUR(totals.invested, hidden)} />
        <MetricCard
          label="Ganho/Perda"
          value={formatEUR(pl, hidden)}
          sub={formatPercent(plPct, hidden)}
          tone={pl > 0 ? "positive" : pl < 0 ? "negative" : "default"}
        />
        <MetricCard label="Posições" value={String(assets.length)} />
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          A carregar…
        </div>
      ) : assets.length === 0 ? (
        <EmptyState
          title={emptyLabel ?? "Ainda não tens posições aqui"}
          description="Adiciona o primeiro ativo para começar a acompanhar esta classe."
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Adicionar primeiro ativo
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Ativo</th>
                <th className="px-4 py-3 text-right font-medium">
                  {assetClass === "metal" ? "Gramas" : assetClass === "p2p" ? "Grupo" : "Qtd."}
                </th>
                <th className="px-4 py-3 text-right font-medium">Investido</th>
                <th className="px-4 py-3 text-right font-medium">Valor atual</th>
                <th className="px-4 py-3 text-right font-medium">P/L</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const p = assetPL(a);
                return (
                  <tr key={a.id} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <p className="font-medium">{a.name}</p>
                      {a.ticker && (
                        <p className="text-xs text-muted-foreground">{a.ticker}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {assetClass === "p2p" ? a.p2p_group ?? "—" : a.quantity || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">{formatEUR(assetInvested(a), hidden)}</td>
                    <td className="px-4 py-3 text-right">{formatEUR(assetCurrentValue(a), hidden)}</td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-medium",
                        p.abs > 0 ? "text-success" : p.abs < 0 ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {formatEUR(p.abs, hidden)}
                      <span className="block text-xs">{formatPercent(p.pct, hidden)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(a)}
                          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label={`Editar ${a.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => remove(a)}
                          className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                          aria-label={`Eliminar ${a.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Editar ativo" : "Adicionar ativo"}
      >
        <div className="space-y-4">
          <Field label="Nome">
            <TextInput
              value={form.name}
              onChange={set("name")}
              placeholder={
                assetClass === "p2p" ? "Ex.: Mintos" : assetClass === "metal" ? "Ex.: Barra de ouro 50g" : "Ex.: Vanguard FTSE All-World"
              }
            />
          </Field>

          {isSecurity(assetClass) && (
            <Field label="Ticker (opcional)">
              <TextInput value={form.ticker} onChange={set("ticker")} placeholder="Ex.: VWCE" />
            </Field>
          )}

          {assetClass === "metal" && (
            <Field label="Metal">
              <select
                value={form.metal_type}
                onChange={set("metal_type")}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
              >
                <option value="Ouro">Ouro</option>
                <option value="Prata">Prata</option>
              </select>
            </Field>
          )}

          {assetClass === "p2p" && (
            <Field label="Grupo">
              <select
                value={form.p2p_group}
                onChange={set("p2p_group")}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
              >
                <option value="A">Grupo A — até 12.4%</option>
                <option value="B">Grupo B — até 25%</option>
              </select>
            </Field>
          )}

          {isSecurity(assetClass) ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Quantidade">
                <TextInput inputMode="decimal" value={form.quantity} onChange={set("quantity")} placeholder="0" />
              </Field>
              <Field label="Preço médio">
                <TextInput inputMode="decimal" value={form.average_price} onChange={set("average_price")} placeholder="0,00" />
              </Field>
              <Field label="Preço atual">
                <TextInput inputMode="decimal" value={form.current_price} onChange={set("current_price")} placeholder="0,00" />
              </Field>
            </div>
          ) : (
            <>
              {assetClass === "metal" && (
                <Field label="Peso (gramas)">
                  <TextInput inputMode="decimal" value={form.quantity} onChange={set("quantity")} placeholder="0" />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Total investido (€)">
                  <TextInput inputMode="decimal" value={form.invested_amount} onChange={set("invested_amount")} placeholder="0,00" />
                </Field>
                <Field label="Valor atual (€)">
                  <TextInput inputMode="decimal" value={form.current_value} onChange={set("current_value")} placeholder="0,00" />
                </Field>
              </div>
            </>
          )}

          {(assetClass === "p2p" || assetClass === "reit" || assetClass === "acao_dividendo") && (
            <Field label="Yield anual (%, opcional)">
              <TextInput inputMode="decimal" value={form.annual_yield} onChange={set("annual_yield")} placeholder="Ex.: 5,2" />
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "A guardar…" : editing ? "Guardar alterações" : "Adicionar"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
