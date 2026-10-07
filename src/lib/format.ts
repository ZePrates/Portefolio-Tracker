import { APP_TIME_ZONE } from "@/lib/dates";

const HIDDEN = "••••";
const EMPTY = "—";

const eurFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

const percentFormatter = new Intl.NumberFormat("pt-PT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatEUR(value: number, hidden = false): string {
  if (hidden) return HIDDEN;
  const v = value ?? 0;
  if (!Number.isFinite(v)) return EMPTY;
  return eurFormatter.format(v);
}

/** Formata um valor na moeda original do ativo (ex.: USD). */
export function formatMoney(value: number, currency = "EUR", hidden = false): string {
  if (hidden) return HIDDEN;
  const v = value ?? 0;
  if (!Number.isFinite(v)) return EMPTY;
  try {
    return new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(v);
  } catch {
    return `${percentFormatter.format(v)} ${currency}`;
  }
}

export function formatPercent(value: number, hidden = false): string {
  if (hidden) return HIDDEN;
  const v = value ?? 0;
  if (!Number.isFinite(v)) return EMPTY;
  const sign = v > 0 ? "+" : "";
  return `${sign}${percentFormatter.format(v)} %`;
}

const dateFormatter = new Intl.DateTimeFormat("pt-PT", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Data em dd/mm/aaaa. Datas simples (YYYY-MM-DD) não sofrem desvio de fuso. */
export function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return dateFormatter.format(d);
}

/**
 * Lê um número escrito à portuguesa ou à inglesa:
 * "1234,56", "1.234,56", "1 234,56", "1234.56", "1,234.56", "1.234.567".
 * Quando há "," e ".", o último é o separador decimal. Um único "." é
 * tratado como decimal (compatível com o formato do extrato XTB).
 * Devolve NaN quando a entrada não é um número inequívoco.
 */
export function parseNumberPt(input: string): number {
  let s = String(input ?? "")
    .replace(/\s/g, "") // \s inclui espaços inseparáveis (U+00A0, U+202F)
    .replace(/[€%]/g, "");
  if (!s) return Number.NaN;
  if (!/^-?[\d.,]+$/.test(s)) return Number.NaN;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;

  if (commas > 0 && dots > 0) {
    if (lastComma > lastDot) {
      // PT: "." milhares, "," decimal
      if (commas > 1) return Number.NaN;
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // EN: "," milhares, "." decimal
      if (dots > 1) return Number.NaN;
      s = s.replace(/,/g, "");
    }
  } else if (commas > 0) {
    if (commas > 1) return Number.NaN;
    s = s.replace(",", ".");
  } else if (dots > 1) {
    // "1.234.567": pontos só podem ser separadores de milhares
    if (!/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number.NaN;
    s = s.replace(/\./g, "");
  }

  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return Number.NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** `parseNumberPt` com valor por omissão para entradas inválidas. */
export function parseNumberOr(input: string, fallback: number): number {
  const n = parseNumberPt(input);
  return Number.isFinite(n) ? n : fallback;
}
