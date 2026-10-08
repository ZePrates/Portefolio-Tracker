import { parseNumberPt } from "@/lib/format";

/** Campos de uma compra/venda (ou edição de movimento), tal como escritos. */
export interface TradeFormValues {
  quantity: string;
  price: string;
  fee: string;
  date: string;
}

export type TradeFormErrors = Partial<Record<keyof TradeFormValues, string>>;

function nonNegative(raw: string, label: string): string | undefined {
  if (raw.trim() === "") return undefined;
  const n = parseNumberPt(raw);
  if (!Number.isFinite(n)) return `${label}: escreve um número (ex.: 12,50).`;
  if (n < 0) return `${label} não pode ser negativo.`;
  return undefined;
}

/**
 * Validação em tempo real de compra/venda. Mesmas regras que o servidor aplica
 * (quantidade > 0; preço e comissão ≥ 0); só adiciona mensagens junto ao campo.
 */
export function validateTradeForm(f: TradeFormValues, today: string): TradeFormErrors {
  const e: TradeFormErrors = {};
  if (f.quantity.trim() === "") e.quantity = "Indica a quantidade.";
  else {
    const q = parseNumberPt(f.quantity);
    if (!Number.isFinite(q)) e.quantity = "Quantidade: escreve um número (ex.: 10 ou 2,5).";
    else if (q <= 0) e.quantity = "A quantidade tem de ser maior que zero.";
  }
  const p = nonNegative(f.price, "Preço");
  if (p) e.price = p;
  const fee = nonNegative(f.fee, "Comissão");
  if (fee) e.fee = fee;
  if (!f.date) e.date = "Indica a data.";
  else if (f.date > today) e.date = "A data não pode ser futura.";
  return e;
}

/** Valor da despesa (> 0). */
export function validateExpenseAmount(raw: string): string | undefined {
  if (raw.trim() === "") return "Indica o valor da despesa.";
  const n = parseNumberPt(raw);
  if (!Number.isFinite(n)) return "Valor: escreve um número (ex.: 25,00).";
  if (n <= 0) return "O valor tem de ser maior que zero.";
  return undefined;
}
