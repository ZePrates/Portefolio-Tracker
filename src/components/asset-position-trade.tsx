import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { Asset } from "@/lib/portfolio-types";
import { buyAsset, previewSale, sellAsset } from "@/lib/portfolio.functions";
import { createExpense } from "@/lib/expenses.functions";
import { splitMetalPurchase } from "@/lib/metals";
import { formatDatePt, formatEUR, formatNumber, formatQuantity, parseNumberOr } from "@/lib/format";
import { Button, Field, TextInput } from "@/components/ui-bits";
import { validateExpenseAmount, validateTradeForm } from "@/lib/trade-form";
import { todayLisbon } from "@/lib/dates";
import { privateEUR, privateMoney } from "@/components/private-value";
import { Row } from "@/components/asset-position-bits";
import { pnlTone as tone } from "@/lib/utils";

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

/**
 * Comprar, vender e (metais) registar a taxa de armazenamento. Montar com
 * `key={asset.id}` para recomeçar os campos ao mudar de ativo.
 */
export function TradePanel({
  asset,
  available,
  lastPremium,
  hidden,
  onChanged,
}: {
  asset: Asset;
  /** Quantidade em carteira (para vender). */
  available: number;
  /** Ágio da última compra de metal, sugerido na compra seguinte. */
  lastPremium: number | null;
  hidden: boolean;
  /** Depois de gravar (recalcular a carteira). */
  onChanged: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const previewFn = useServerFn(previewSale);
  const buyFn = useServerFn(buyAsset);
  const sellFn = useServerFn(sellAsset);
  const createExpenseFn = useServerFn(createExpense);
  const isMetal = asset.class === "metal";

  const [mode, setMode] = useState<"view" | "buy" | "sell" | "expense">("view");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");
  // Metais: taxa paga em gramas e compra introduzida como no extrato da custódia.
  const [expenseGrams, setExpenseGrams] = useState("");
  const [expensePerGram, setExpensePerGram] = useState("");
  const [metalPaid, setMetalPaid] = useState("");
  const [metalPremium, setMetalPremium] = useState("");

  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState(() =>
    String(asset.current_price_native ?? asset.current_price ?? "").replace(".", ","),
  );
  const [fee, setFee] = useState("");
  const [date, setDate] = useState(today);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currency = asset.native_currency || "EUR";

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));
  const tradeErrors = useMemo(
    () => validateTradeForm({ quantity, price, fee, date }, today()),
    [quantity, price, fee, date],
  );
  const expenseError = useMemo(() => validateExpenseAmount(expenseAmount), [expenseAmount]);
  const tradeErr = (k: "quantity" | "price" | "fee" | "date") =>
    touched["trade_" + k] ? tradeErrors[k] : undefined;

  // Pré-visualização em tempo real da venda
  useEffect(() => {
    if (mode !== "sell") return;
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
  }, [mode, quantity, price, fee, date, asset.id]);

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
      await onChanged();
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
      await onChanged();
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
      if (g > 0) await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registar a despesa.");
    } finally {
      setSaving(false);
    }
  };

  return mode === "view" ? (
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
      <Button variant="outline" onClick={() => setMode("sell")} disabled={available <= 0}>
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
        Se a custódia cobra em metal (ex.: Elementum), indica os gramas deduzidos: saem do cofre sem
        contar como venda. Paga em dinheiro: deixa os gramas a 0.
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
            disponível: {formatQuantity(available)}
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
              {formatNumber(metalSplit.spot, 4)} €/g + ágio {privateEUR(metalSplit.premium, hidden)}
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
              isMetal ? "Preço de recompra por grama (EUR)" : `Preço por unidade (${currency})`
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
          <Row label="Quantidade disponível" value={String(Number(preview.available.toFixed(6)))} />
          <Row label="Quantidade a vender" value={String(num(quantity))} />
          <Row
            label={`Preço de venda (${currency})`}
            value={privateMoney(num(price), currency, hidden)}
          />
          <Row label="Receita bruta" value={privateEUR(preview.proceeds, hidden)} />
          <Row label="Custo (FIFO)" value={privateEUR(preview.costBasis, hidden)} />
          <Row label="Comissão" value={privateEUR(preview.fee, hidden)} />
          <Row
            label="Lucro/prejuízo realizado"
            value={privateEUR(preview.realizedPL, hidden)}
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
          {saving ? "A registar…" : mode === "buy" ? "Confirmar compra" : "Confirmar venda"}
        </Button>
      </div>
    </div>
  );
}
