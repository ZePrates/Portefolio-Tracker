import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Pencil, Trash2, RefreshCw, Search, Download, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import {
  type Asset,
  type AssetClass,
  assetCurrentValue,
  assetInvested,
  assetPL,
  assetRealizedPL,
  isOpenPosition,
} from "@/lib/portfolio-types";
import { AssetPositionModal } from "@/components/asset-position-modal";
import { listAssets, createAsset, updateAsset, deleteAsset } from "@/lib/portfolio.functions";
import {
  refreshPricesFromYahoo,
  lookupTicker,
  importDividendsForAsset,
} from "@/lib/prices.functions";
import { formatEUR, formatMoney, formatPercent } from "@/lib/format";
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
  purchase_price: string;
  current_price: string;
  invested_amount: string;
  current_value: string;
  metal_type: string;
  p2p_group: string;
  annual_yield: string;
  currency: string;
  frequency: string;
}

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "CAD"];

function defaultCurrency(c: AssetClass) {
  return c === "etf" ? "EUR" : "USD";
}

function emptyForm(c: AssetClass): FormState {
  return {
    name: "",
    ticker: "",
    quantity: "",
    purchase_price: "",
    current_price: "",
    invested_amount: "",
    current_value: "",
    metal_type: "Ouro",
    p2p_group: "A",
    annual_yield: "",
    currency: defaultCurrency(c),
    frequency: "",
  };
}

function num(s: string): number {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function isSecurity(c: AssetClass) {
  return c === "etf" || c === "reit" || c === "acao_dividendo" || c === "acao_crescimento";
}

function paysDividends(c: AssetClass) {
  return c === "reit" || c === "acao_dividendo" || c === "etf";
}

export function AssetClassPage({ assetClass, title, subtitle, emptyLabel }: Props) {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const fetchAssets = useServerFn(listAssets);
  const createFn = useServerFn(createAsset);
  const updateFn = useServerFn(updateAsset);
  const deleteFn = useServerFn(deleteAsset);
  const refreshFn = useServerFn(refreshPricesFromYahoo);
  const lookupFn = useServerFn(lookupTicker);
  const importDivFn = useServerFn(importDividendsForAsset);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(assetClass));
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [looking, setLooking] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [positionAsset, setPositionAsset] = useState<Asset | null>(null);
  const [fxRate, setFxRate] = useState<number>(1);

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
    setForm(emptyForm(assetClass));
    setFxRate(1);
    setDialogOpen(true);
  };

  const openEdit = (a: Asset) => {
    setEditing(a);
    const cur = a.native_currency || "EUR";
    const rate =
      a.current_price_native && a.current_price_native > 0 && a.current_price > 0
        ? a.current_price / a.current_price_native
        : 1;
    setFxRate(cur === "EUR" ? 1 : rate);
    setForm({
      name: a.name,
      ticker: a.ticker ?? "",
      quantity: a.quantity ? String(a.quantity) : "",
      purchase_price: String(a.purchase_price_native ?? a.average_price ?? "") || "",
      current_price: String(a.current_price_native ?? a.current_price ?? "") || "",
      invested_amount: a.invested_amount ? String(a.invested_amount) : "",
      current_value: a.current_value ? String(a.current_value) : "",
      metal_type: a.metal_type ?? "Ouro",
      p2p_group: a.p2p_group ?? "A",
      annual_yield: a.annual_yield != null ? String(a.annual_yield) : "",
      currency: cur,
      frequency: a.dividend_frequency ?? "",
    });
    setDialogOpen(true);
  };

  /** Vai buscar ao Yahoo Finance toda a informação do ticker. */
  const lookup = async () => {
    const ticker = form.ticker.trim();
    if (!ticker) {
      toast.error("Escreve primeiro o ticker.");
      return;
    }
    setLooking(true);
    const id = toast.loading(`A procurar ${ticker} no Yahoo Finance...`);
    try {
      const info = (await lookupFn({ data: { ticker } })) as {
        name: string;
        currency: string;
        price: number;
        rate: number | null;
        annualYield: number | null;
        frequency: string | null;
        dividendsPerShareTTM: number;
      };
      setFxRate(info.rate ?? 1);
      setForm((f) => ({
        ...f,
        name: f.name.trim() || info.name,
        currency: info.currency,
        current_price: String(info.price),
        purchase_price: f.purchase_price || String(info.price),
        annual_yield: info.annualYield != null ? info.annualYield.toFixed(2) : f.annual_yield,
        frequency: info.frequency ?? f.frequency,
      }));
      toast.success(
        info.annualYield != null
          ? `${info.name}: ${info.price} ${info.currency} · yield ${info.annualYield.toFixed(2)}%`
          : `${info.name}: ${info.price} ${info.currency}`,
        { id },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não encontrei este ticker.", { id });
    } finally {
      setLooking(false);
    }
  };

  const rateFor = async (currency: string): Promise<number> => {
    if (currency === "EUR") return 1;
    if (fxRate && fxRate !== 1) return fxRate;
    const info = (await lookupFn({ data: { ticker: `${currency}EUR=X` } })) as { price: number };
    return info.price;
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Indica o nome do ativo.");
      return;
    }
    setSaving(true);
    try {
      const quantity = num(form.quantity);
      const rate = isSecurity(assetClass) ? await rateFor(form.currency) : 1;
      const purchaseNative = num(form.purchase_price);
      const currentNative = num(form.current_price);
      const purchaseEur = purchaseNative * rate;
      const currentEur = currentNative * rate;
      const invested = isSecurity(assetClass)
        ? quantity * purchaseEur
        : num(form.invested_amount);
      const current = isSecurity(assetClass) ? quantity * currentEur : num(form.current_value);
      const payload = {
        class: assetClass,
        name: form.name.trim(),
        ticker: form.ticker.trim() || null,
        quantity,
        average_price: purchaseEur,
        current_price: currentEur,
        invested_amount: invested,
        current_value: current,
        currency: "EUR",
        native_currency: isSecurity(assetClass) ? form.currency : "EUR",
        purchase_price_native: isSecurity(assetClass) ? purchaseNative : null,
        current_price_native: isSecurity(assetClass) ? currentNative : null,
        dividend_frequency: form.frequency.trim() || null,
        metal_type: assetClass === "metal" ? form.metal_type : null,
        p2p_group: assetClass === "p2p" ? form.p2p_group : null,
        annual_yield: form.annual_yield ? num(form.annual_yield) : null,
      };
      if (editing) {
        await updateFn({ data: { id: editing.id, patch: payload } });
        toast.success("Ativo atualizado.");
      } else {
        const created = (await createFn({ data: payload })) as { id: string };
        toast.success("Ativo adicionado.");
        if (paysDividends(assetClass) && payload.ticker && created?.id) {
          try {
            const res = (await importDivFn({ data: { assetId: created.id, years: 3 } })) as {
              imported: number;
            };
            if (res.imported > 0) toast.success(`${res.imported} dividendos importados.`);
          } catch {
            /* importação é best-effort */
          }
        }
      }
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      await queryClient.invalidateQueries({ queryKey: ["dividends"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao guardar.");
    } finally {
      setSaving(false);
    }
  };

  const importDividends = async (a: Asset) => {
    setImportingId(a.id);
    const id = toast.loading(`A importar dividendos de ${a.name}...`);
    try {
      const res = (await importDivFn({ data: { assetId: a.id, years: 3 } })) as {
        imported: number;
      };
      await queryClient.invalidateQueries({ queryKey: ["dividends"] });
      toast.success(
        res.imported > 0 ? `${res.imported} dividendos importados.` : "Sem dividendos novos.",
        { id },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar dividendos.", { id });
    } finally {
      setImportingId(null);
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
            <Button variant="outline" onClick={refreshPrices} disabled={refreshing}>
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
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
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Ativo</th>
                <th className="px-4 py-3 text-right font-medium">
                  {assetClass === "metal" ? "Gramas" : assetClass === "p2p" ? "Grupo" : "Qtd."}
                </th>
                {isSecurity(assetClass) && (
                  <>
                    <th className="px-4 py-3 text-right font-medium">Preço compra</th>
                    <th className="px-4 py-3 text-right font-medium">Preço atual</th>
                  </>
                )}
                <th className="px-4 py-3 text-right font-medium">Investido</th>
                <th className="px-4 py-3 text-right font-medium">Valor atual</th>
                <th className="px-4 py-3 text-right font-medium">P/L</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const p = assetPL(a);
                const cur = a.native_currency || "EUR";
                const foreign = cur !== "EUR";
                const rate =
                  a.current_price_native && a.current_price_native > 0 && a.current_price > 0
                    ? a.current_price / a.current_price_native
                    : 1;
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
                    {isSecurity(assetClass) && (
                      <>
                        <td className="px-4 py-3 text-right">
                          {formatEUR(a.average_price ?? 0, hidden)}
                          {foreign && a.purchase_price_native != null && (
                            <span className="block text-xs text-muted-foreground">
                              {formatMoney(a.purchase_price_native, cur, hidden)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatEUR(a.current_price ?? 0, hidden)}
                          {foreign && a.current_price_native != null && (
                            <span className="block text-xs text-muted-foreground">
                              {formatMoney(a.current_price_native, cur, hidden)}
                            </span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3 text-right">
                      {formatEUR(assetInvested(a), hidden)}
                      {foreign && (
                        <span className="block text-xs text-muted-foreground">
                          {formatMoney(assetInvested(a) / rate, cur, hidden)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatEUR(assetCurrentValue(a), hidden)}
                      {foreign && (
                        <span className="block text-xs text-muted-foreground">
                          {formatMoney(assetCurrentValue(a) / rate, cur, hidden)}
                        </span>
                      )}
                    </td>
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
                        {paysDividends(assetClass) && a.ticker && (
                          <button
                            onClick={() => importDividends(a)}
                            disabled={importingId === a.id}
                            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                            aria-label={`Importar dividendos de ${a.name}`}
                            title="Importar dividendos do Yahoo Finance"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        )}
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
          {isSecurity(assetClass) && (
            <Field label="Ticker">
              <div className="flex gap-2">
                <TextInput
                  value={form.ticker}
                  onChange={set("ticker")}
                  placeholder="Ex.: O, VICI, VWCE.DE"
                />
                <Button variant="outline" onClick={lookup} disabled={looking}>
                  <Search className={cn("h-4 w-4", looking && "animate-pulse")} />
                  {looking ? "A procurar…" : "Procurar"}
                </Button>
              </div>
            </Field>
          )}

          <Field label="Nome">
            <TextInput
              value={form.name}
              onChange={set("name")}
              placeholder={
                assetClass === "p2p" ? "Ex.: Mintos" : assetClass === "metal" ? "Ex.: Barra de ouro 50g" : "Ex.: Realty Income"
              }
            />
          </Field>

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
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantidade">
                  <TextInput inputMode="decimal" value={form.quantity} onChange={set("quantity")} placeholder="0" />
                </Field>
                <Field label="Moeda">
                  <select
                    value={form.currency}
                    onChange={set("currency")}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Preço de compra por ação (${form.currency})`}>
                  <TextInput inputMode="decimal" value={form.purchase_price} onChange={set("purchase_price")} placeholder="0,00" />
                </Field>
                <Field label={`Preço atual (${form.currency})`}>
                  <TextInput inputMode="decimal" value={form.current_price} onChange={set("current_price")} placeholder="0,00" />
                </Field>
              </div>
            </>
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

          {(assetClass === "p2p" || paysDividends(assetClass)) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Yield anual (%)">
                <TextInput inputMode="decimal" value={form.annual_yield} onChange={set("annual_yield")} placeholder="Ex.: 5,2" />
              </Field>
              {assetClass !== "p2p" && (
                <Field label="Frequência">
                  <TextInput value={form.frequency} onChange={set("frequency")} placeholder="Ex.: Mensal" />
                </Field>
              )}
            </div>
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
