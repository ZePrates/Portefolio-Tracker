import { parseNumberPt } from "@/lib/format";
import { isValidIsin } from "@/lib/identifiers";

/** Campos do formulário de ativo, tal como escritos (texto, vírgula decimal). */
export interface AssetFormValues {
  name: string;
  isin: string;
  quantity: string;
  purchase_price: string;
  purchase_date: string;
  current_price: string;
  invested_amount: string;
  current_value: string;
  annual_yield: string;
}

export type AssetFormErrors = Partial<Record<keyof AssetFormValues, string>>;

/** Vazio é válido (conta como 0); texto que não é número, ou negativo, não. */
function numberError(raw: string, label: string): string | undefined {
  if (raw.trim() === "") return undefined;
  const n = parseNumberPt(raw);
  if (!Number.isFinite(n)) return `${label}: escreve um número (ex.: 12,50).`;
  if (n < 0) return `${label} não pode ser negativo.`;
  return undefined;
}

/**
 * Validação em tempo real do formulário de ativo. Só devolve problemas que o
 * servidor também rejeitaria ou que produziriam valores a 0 em silêncio; não
 * altera nenhum cálculo.
 */
export function validateAssetForm(
  f: AssetFormValues,
  opts: { quantityAsset: boolean; editing: boolean; isEtf: boolean; today: string },
): AssetFormErrors {
  const e: AssetFormErrors = {};
  if (!f.name.trim()) e.name = "Indica o nome do ativo.";

  const isin = f.isin.trim().toUpperCase();
  if (opts.isEtf && isin && !isValidIsin(isin))
    e.isin = "ISIN inválido: tem 12 caracteres (ex.: IE00BK5BQT80).";

  if (opts.quantityAsset) {
    const q = numberError(f.quantity, "Quantidade");
    if (q) e.quantity = q;
    const pp = numberError(f.purchase_price, "Preço de compra");
    if (pp) e.purchase_price = pp;
    const cp = numberError(f.current_price, "Preço atual");
    if (cp) e.current_price = cp;

    const quantity = parseNumberPt(f.quantity);
    if (!opts.editing && quantity > 0) {
      if (!f.purchase_date) e.purchase_date = "Indica a data da compra.";
      else if (f.purchase_date > opts.today)
        e.purchase_date = "A data da compra não pode ser futura.";
    }
  } else {
    const inv = numberError(f.invested_amount, "Total investido");
    if (inv) e.invested_amount = inv;
    const cv = numberError(f.current_value, "Valor atual");
    if (cv) e.current_value = cv;
  }

  if (f.annual_yield.trim() !== "") {
    const y = parseNumberPt(f.annual_yield);
    if (!Number.isFinite(y) || y < 0 || y > 100)
      e.annual_yield = "Indica uma percentagem entre 0 e 100.";
  }
  return e;
}
