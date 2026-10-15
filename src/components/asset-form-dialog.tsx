import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { toast } from "sonner";
import type { Asset, AssetClass } from "@/lib/portfolio-types";
import { invalidatePortfolio } from "@/lib/portfolio-queries";
import { createAsset, updateAsset, buyAsset } from "@/lib/portfolio.functions";
import { lookupTicker } from "@/lib/prices.functions";
import { syncDividendsForAsset } from "@/lib/dividends.functions";
import { formatNumber, parseNumberOr } from "@/lib/format";
import { Button, Modal, Field, SelectInput, TextInput } from "@/components/ui-bits";
import { todayLisbon } from "@/lib/dates";
import { validateAssetForm, type AssetFormValues } from "@/lib/asset-form";
import {
  buybackDiscountOf,
  buybackPrice,
  DEFAULT_BUYBACK_DISCOUNT,
  spotFromBuyback,
} from "@/lib/metals";
import { isQuantityClass, isSecurityClass, paysDividendsClass } from "@/lib/asset-class";

interface FormState {
  name: string;
  ticker: string;
  isin: string;
  quantity: string;
  purchase_price: string;
  purchase_date: string;
  current_price: string;
  invested_amount: string;
  current_value: string;
  metal_type: string;
  p2p_group: string;
  annual_yield: string;
  currency: string;
  frequency: string;
  /** Metais em custódia. Desconto de recompra em %. */
  custodian: string;
  vault_ref: string;
  plan_name: string;
  buyback_discount: string;
}

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "CAD"];
const LEDGER_HINT =
  "Calculado a partir dos movimentos. Para alterar, usa Comprar/Vender → editar movimento.";

const today = () => todayLisbon();

function defaultCurrency(c: AssetClass) {
  return c === "etf" || c === "metal" ? "EUR" : "USD";
}

function emptyForm(c: AssetClass): FormState {
  return {
    name: "",
    ticker: "",
    isin: "",
    quantity: "",
    purchase_price: "",
    purchase_date: today(),
    current_price: "",
    invested_amount: "",
    current_value: "",
    metal_type: "Ouro",
    p2p_group: "A",
    annual_yield: "",
    currency: defaultCurrency(c),
    frequency: "",
    custodian: "",
    vault_ref: "",
    plan_name: "",
    buyback_discount: formatNumber(DEFAULT_BUYBACK_DISCOUNT * 100, 2),
  };
}

function num(s: string): number {
  return parseNumberOr(s, 0);
}

const isSecurity = isSecurityClass;
const isQuantityAsset = isQuantityClass;
const paysDividends = paysDividendsClass;

/** Câmbio implícito na cotação guardada (1 para EUR). */
function rateOfAsset(a: Asset): number {
  const cur = a.native_currency || "EUR";
  const rate =
    a.current_price_native && a.current_price_native > 0 && a.current_price > 0
      ? a.current_price / a.current_price_native
      : 1;
  return cur === "EUR" ? 1 : rate;
}

/** Valores do formulário a partir de um ativo guardado. */
function formFromAsset(a: Asset): FormState {
  const cur = a.native_currency || "EUR";
  return {
    name: a.name,
    ticker: a.ticker ?? "",
    isin: a.isin ?? "",
    quantity: a.quantity ? String(a.quantity) : "",
    purchase_price: String(a.purchase_price_native ?? a.average_price ?? "") || "",
    purchase_date: today(),
    // Metal: o formulário mostra o spot; `current_price` guarda a recompra.
    current_price:
      a.class === "metal"
        ? String(
            spotFromBuyback(
              a.current_price_native ?? a.current_price ?? 0,
              buybackDiscountOf(a.buyback_discount),
            ) || "",
          )
        : String(a.current_price_native ?? a.current_price ?? "") || "",
    invested_amount: a.invested_amount ? String(a.invested_amount) : "",
    current_value: a.current_value ? String(a.current_value) : "",
    metal_type: a.metal_type ?? "Ouro",
    p2p_group: a.p2p_group ?? "A",
    annual_yield: a.annual_yield != null ? String(a.annual_yield) : "",
    currency: cur,
    frequency: a.dividend_frequency ?? "",
    custodian: a.custodian ?? "",
    vault_ref: a.vault_ref ?? "",
    plan_name: a.plan_name ?? "",
    buyback_discount: formatNumber(buybackDiscountOf(a.buyback_discount) * 100, 2),
  };
}

/**
 * Adicionar ou editar um ativo. Montar com uma `key` nova a cada abertura,
 * para os campos recomeçarem.
 */
export function AssetFormDialog({
  assetClass,
  open,
  editing,
  onClose,
}: {
  assetClass: AssetClass;
  open: boolean;
  /** Ativo a editar; null para adicionar. */
  editing: Asset | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createAsset);
  const buyFn = useServerFn(buyAsset);
  const updateFn = useServerFn(updateAsset);
  const lookupFn = useServerFn(lookupTicker);
  const syncDivFn = useServerFn(syncDividendsForAsset);

  const [form, setForm] = useState<FormState>(() =>
    editing ? formFromAsset(editing) : emptyForm(assetClass),
  );
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);
  const [fxRate, setFxRate] = useState<number>(() => (editing ? rateOfAsset(editing) : 1));
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const formErrors = useMemo(
    () =>
      validateAssetForm(form, {
        quantityAsset: isQuantityAsset(assetClass),
        editing: !!editing,
        isEtf: assetClass === "etf",
        today: today(),
      }),
    [form, assetClass, editing],
  );
  const err = (k: keyof AssetFormValues) => (touched[k] ? formErrors[k] : undefined);
  const touch = (k: keyof AssetFormValues) => () => setTouched((t) => ({ ...t, [k]: true }));

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
          ? `${info.name}: ${info.price} ${info.currency} · yield ${formatNumber(info.annualYield, 2)} %`
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
    setTouched({
      name: true,
      isin: true,
      quantity: true,
      purchase_price: true,
      purchase_date: true,
      current_price: true,
      invested_amount: true,
      current_value: true,
      annual_yield: true,
    });
    if (Object.keys(formErrors).length > 0) return;
    const isin = form.isin.trim().toUpperCase();
    setSaving(true);
    try {
      const quantity = num(form.quantity);
      const rate = isQuantityAsset(assetClass) ? await rateFor(form.currency) : 1;
      const purchaseNative = num(form.purchase_price);
      const isMetal = assetClass === "metal";
      const discount = isMetal ? num(form.buyback_discount) / 100 : 0;
      // Metal: o utilizador indica o spot; guarda-se o preço de recompra.
      const currentNative = isMetal
        ? buybackPrice(num(form.current_price), discount)
        : num(form.current_price);
      const purchaseEur = purchaseNative * rate;
      const currentEur = currentNative * rate;
      const invested = isQuantityAsset(assetClass)
        ? quantity * purchaseEur
        : num(form.invested_amount);
      const current = isQuantityAsset(assetClass) ? quantity * currentEur : num(form.current_value);
      const payload = {
        class: assetClass,
        name: form.name.trim(),
        ticker: form.ticker.trim() || null,
        isin: isin || null,
        quantity,
        average_price: purchaseEur,
        current_price: currentEur,
        invested_amount: invested,
        current_value: current,
        currency: "EUR",
        native_currency: isQuantityAsset(assetClass) ? form.currency : "EUR",
        purchase_price_native: isQuantityAsset(assetClass) ? purchaseNative : null,
        current_price_native: isQuantityAsset(assetClass) ? currentNative : null,
        dividend_frequency: form.frequency.trim() || null,
        metal_type: isMetal ? form.metal_type : null,
        custodian: isMetal ? form.custodian.trim() || null : null,
        vault_ref: isMetal ? form.vault_ref.trim() || null : null,
        plan_name: isMetal ? form.plan_name.trim() || null : null,
        buyback_discount: isMetal ? discount : null,
        p2p_group: assetClass === "p2p" ? form.p2p_group : null,
        annual_yield: form.annual_yield ? num(form.annual_yield) : null,
      };
      let createdId: string | undefined;
      if (editing) {
        await updateFn({ data: { id: editing.id, patch: payload } });
        toast.success("Ativo atualizado.");
      } else if (isQuantityAsset(assetClass) && quantity > 0) {
        // Ativos com quantidade nascem sempre com uma compra no livro FIFO
        // (transactions), nunca com os campos agregados preenchidos
        // diretamente — de outro modo não há data de compra registada e
        // uma venda futura falha por não encontrar lotes abertos.
        const created = (await createFn({
          data: { ...payload, quantity: 0, average_price: 0, invested_amount: 0, current_value: 0 },
        })) as { id: string };
        await buyFn({
          data: {
            assetId: created.id,
            quantity,
            price_native: purchaseNative,
            fee_native: 0,
            traded_at: form.purchase_date,
            notes: null,
          },
        });
        createdId = created.id;
        toast.success("Ativo adicionado.");
      } else {
        const created = (await createFn({ data: payload })) as { id: string };
        createdId = created.id;
        toast.success("Ativo adicionado.");
      }
      if (!editing && paysDividends(assetClass) && payload.ticker && createdId) {
        try {
          const res = (await syncDivFn({ data: { assetId: createdId } })) as {
            inserted: number;
          };
          if (res.inserted > 0)
            toast.success(`${res.inserted} dividendos sincronizados desde a compra.`);
        } catch {
          /* sincronização é best-effort */
        }
      }
      onClose();
      await invalidatePortfolio(queryClient);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao guardar.");
    } finally {
      setSaving(false);
    }
  };

  const set =
    (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setTouched((t) => ({ ...t, [key]: true }));
    };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Editar ativo" : "Adicionar ativo"}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        {isSecurity(assetClass) && (
          <>
            <Field label="Ticker">
              <div className="flex gap-2">
                <TextInput
                  value={form.ticker}
                  onChange={set("ticker")}
                  placeholder="Ex.: O, VICI, VWCE.DE"
                  autoComplete="off"
                />
                {assetClass !== "etf" && (
                  <Button type="button" variant="outline" onClick={lookup} loading={looking}>
                    {!looking && <Search aria-hidden className="h-4 w-4" />}
                    {looking ? "A procurar…" : "Procurar"}
                  </Button>
                )}
              </div>
            </Field>

            {assetClass === "etf" && (
              <Field
                label="ISIN (opcional)"
                error={err("isin")}
                hint="Usado para obter a composição e exposição exclusivamente no JustETF."
              >
                <TextInput
                  value={form.isin}
                  onChange={set("isin")}
                  onBlur={touch("isin")}
                  placeholder="Ex.: IE00BK5BQT80"
                  maxLength={12}
                  autoComplete="off"
                  className="uppercase"
                />
              </Field>
            )}
          </>
        )}

        <Field label="Nome" required error={err("name")}>
          <TextInput
            value={form.name}
            onChange={set("name")}
            onBlur={touch("name")}
            autoComplete="off"
            placeholder={
              assetClass === "p2p"
                ? "Ex.: Mintos"
                : assetClass === "metal"
                  ? "Ex.: Barra de ouro 50g"
                  : "Ex.: Realty Income"
            }
          />
        </Field>

        {assetClass === "metal" && (
          <>
            <Field label="Metal">
              <SelectInput value={form.metal_type} onChange={set("metal_type")}>
                <option value="Ouro">Ouro</option>
                <option value="Prata">Prata</option>
              </SelectInput>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Custódia">
                <TextInput
                  value={form.custodian}
                  onChange={set("custodian")}
                  autoComplete="off"
                  placeholder="Ex.: Elementum"
                />
              </Field>
              <Field label="Plano">
                <TextInput
                  value={form.plan_name}
                  onChange={set("plan_name")}
                  autoComplete="off"
                  placeholder="Ex.: Argentum Premium"
                />
              </Field>
              <Field label="Depósito / cofre">
                <TextInput
                  value={form.vault_ref}
                  onChange={set("vault_ref")}
                  autoComplete="off"
                  placeholder="Ex.: 1057-CH408"
                />
              </Field>
              <Field
                label="Desconto de recompra (%)"
                hint="Spot − este desconto = o que recebes ao vender"
              >
                <TextInput
                  inputMode="decimal"
                  value={form.buyback_discount}
                  onChange={set("buyback_discount")}
                  placeholder="3"
                />
              </Field>
            </div>
          </>
        )}

        {assetClass === "p2p" && (
          <Field label="Grupo">
            <SelectInput value={form.p2p_group} onChange={set("p2p_group")}>
              <option value="A">Grupo A — até 12,4 %</option>
              <option value="B">Grupo B — até 25 %</option>
            </SelectInput>
          </Field>
        )}

        {isQuantityAsset(assetClass) ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={assetClass === "metal" ? "Peso (gramas)" : "Quantidade"}
                error={err("quantity")}
                hint={editing ? LEDGER_HINT : undefined}
              >
                <TextInput
                  disabled={!!editing}
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.quantity}
                  onChange={set("quantity")}
                  onBlur={touch("quantity")}
                  placeholder="0"
                />
              </Field>
              <Field label="Moeda">
                <SelectInput value={form.currency} onChange={set("currency")}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            </div>
            {!editing && (
              <Field label="Data da compra" error={err("purchase_date")}>
                <TextInput
                  type="date"
                  value={form.purchase_date}
                  onChange={set("purchase_date")}
                  onBlur={touch("purchase_date")}
                  max={today()}
                />
              </Field>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={`Preço de compra por ${assetClass === "metal" ? "grama" : "ação"} (${form.currency})`}
                error={err("purchase_price")}
                hint={editing ? LEDGER_HINT : undefined}
              >
                <TextInput
                  disabled={!!editing}
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.purchase_price}
                  onChange={set("purchase_price")}
                  onBlur={touch("purchase_price")}
                  placeholder="0,00"
                />
              </Field>
              <Field
                label={
                  assetClass === "metal"
                    ? `Spot por grama (${form.currency})`
                    : `Preço atual (${form.currency})`
                }
                hint={
                  assetClass === "metal"
                    ? "Atualizado automaticamente (Yahoo). O valor usa a recompra."
                    : undefined
                }
                error={err("current_price")}
              >
                <TextInput
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.current_price}
                  onChange={set("current_price")}
                  onBlur={touch("current_price")}
                  placeholder="0,00"
                />
              </Field>
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Total investido (€)" error={err("invested_amount")}>
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={form.invested_amount}
                onChange={set("invested_amount")}
                onBlur={touch("invested_amount")}
                placeholder="0,00"
              />
            </Field>
            <Field label="Valor atual (€)" error={err("current_value")}>
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={form.current_value}
                onChange={set("current_value")}
                onBlur={touch("current_value")}
                placeholder="0,00"
              />
            </Field>
          </div>
        )}

        {(assetClass === "p2p" || paysDividends(assetClass)) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Yield anual (%)" error={err("annual_yield")}>
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={form.annual_yield}
                onChange={set("annual_yield")}
                onBlur={touch("annual_yield")}
                placeholder="Ex.: 5,2"
              />
            </Field>
            {assetClass !== "p2p" && (
              <Field label="Frequência">
                <TextInput
                  value={form.frequency}
                  onChange={set("frequency")}
                  placeholder="Ex.: Mensal"
                />
              </Field>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            {editing ? "Guardar alterações" : "Adicionar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
