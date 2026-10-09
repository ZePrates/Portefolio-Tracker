/**
 * Exportação CSV em formato português — lógica pura.
 * Separador ";", vírgula decimal sem separador de milhares (o Excel PT lê
 * diretamente como número), datas dd/mm/aaaa e BOM UTF-8 para acentos.
 */

import { formatDatePt } from "@/lib/format";
import type { TaxReport } from "@/lib/tax-report";

export type CsvType = "text" | "number" | "money" | "percent" | "date";

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  type?: CsvType;
  /** Casas decimais para number (por omissão 6, sem zeros à direita). */
  decimals?: number;
}

const BOM = String.fromCharCode(0xfeff);

function numberPt(n: number, decimals: number, fixed: boolean): string {
  if (!Number.isFinite(n)) return "";
  const s = fixed ? n.toFixed(decimals) : String(Number(n.toFixed(decimals)));
  return s.replace(".", ",");
}

export function formatCsvCell(
  value: string | number | null | undefined,
  type: CsvType = "text",
  decimals = 6,
): string {
  if (value == null || value === "") return "";
  switch (type) {
    case "money":
      return numberPt(Number(value), 2, true);
    case "percent":
      return numberPt(Number(value), 2, true);
    case "number":
      return numberPt(Number(value), decimals, false);
    case "date": {
      const s = formatDatePt(String(value));
      return s === "—" ? "" : s;
    }
    default:
      return String(value);
  }
}

function quote(cell: string): string {
  return /[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsvPt<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  opts: { bom?: boolean } = {},
): string {
  const lines = [columns.map((c) => quote(c.header)).join(";")];
  for (const r of rows) {
    lines.push(columns.map((c) => quote(formatCsvCell(c.value(r), c.type, c.decimals))).join(";"));
  }
  return (opts.bom === false ? "" : BOM) + lines.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ */
/* Exportadores                                                        */
/* ------------------------------------------------------------------ */

export interface CsvTransaction {
  traded_at: string;
  type: string;
  quantity: number;
  price: number;
  price_native?: number | null;
  native_currency?: string | null;
  fx_rate?: number | null;
  fee?: number | null;
  total?: number | null;
  realized_pl?: number | null;
  asset_id: string | null;
}

export function transactionsCsv(
  rows: CsvTransaction[],
  assetName: (id: string | null) => string,
): string {
  return toCsvPt(rows, [
    { header: "Data", value: (r) => r.traded_at, type: "date" },
    { header: "Ativo", value: (r) => assetName(r.asset_id) },
    {
      header: "Tipo",
      value: (r) => (r.type === "buy" ? "Compra" : r.type === "sell" ? "Venda" : r.type),
    },
    { header: "Quantidade", value: (r) => r.quantity, type: "number" },
    { header: "Preço (moeda)", value: (r) => r.price_native, type: "number" },
    { header: "Moeda", value: (r) => r.native_currency ?? "EUR" },
    { header: "Câmbio", value: (r) => r.fx_rate, type: "number" },
    { header: "Preço (EUR)", value: (r) => r.price, type: "number" },
    { header: "Comissão (EUR)", value: (r) => r.fee, type: "money" },
    { header: "Total (EUR)", value: (r) => r.total, type: "money" },
    { header: "Mais/menos-valia (EUR)", value: (r) => r.realized_pl, type: "money" },
  ]);
}

export interface CsvDividend {
  asset_name: string;
  ex_date?: string | null;
  payment_date?: string | null;
  paid_at: string;
  currency?: string | null;
  gross_amount?: number | null;
  amount: number;
  tax_amount?: number | null;
  net_amount?: number | null;
  status?: string | null;
  payment_date_estimated?: boolean | null;
}

export function dividendsCsv(rows: CsvDividend[]): string {
  return toCsvPt(rows, [
    { header: "Ativo", value: (r) => r.asset_name },
    { header: "Data ex", value: (r) => r.ex_date, type: "date" },
    { header: "Data pagamento", value: (r) => r.payment_date ?? r.paid_at, type: "date" },
    { header: "Data estimada", value: (r) => (r.payment_date_estimated ? "Sim" : "Não") },
    { header: "Moeda", value: (r) => r.currency ?? "EUR" },
    { header: "Bruto (EUR)", value: (r) => r.gross_amount ?? r.amount, type: "money" },
    { header: "Retenção (EUR)", value: (r) => r.tax_amount ?? 0, type: "money" },
    {
      header: "Líquido (EUR)",
      value: (r) => r.net_amount ?? r.gross_amount ?? r.amount,
      type: "money",
    },
    { header: "Estado", value: (r) => r.status ?? "" },
  ]);
}

/** Resumo fiscal: secção de mais-valias seguida da de dividendos. */
export function taxReportCsv(report: TaxReport): string {
  const gains = toCsvPt(report.capitalGains, [
    { header: "Anexo", value: (r) => r.annex },
    { header: "Código", value: (r) => r.code },
    { header: "País", value: (r) => r.country ?? "" },
    { header: "Ativo", value: (r) => r.assetName },
    { header: "ISIN", value: (r) => r.isin ?? "" },
    { header: "Data aquisição", value: (r) => r.acquisitionDate, type: "date" },
    { header: "Data realização", value: (r) => r.realizationDate, type: "date" },
    { header: "Quantidade", value: (r) => r.quantity, type: "number" },
    { header: "Valor aquisição (EUR)", value: (r) => r.acquisitionValue, type: "money" },
    { header: "Valor realização (EUR)", value: (r) => r.realizationValue, type: "money" },
    { header: "Despesas e encargos (EUR)", value: (r) => r.expenses, type: "money" },
    { header: "Mais/menos-valia (EUR)", value: (r) => r.gain, type: "money" },
  ]);
  const divs = toCsvPt(
    report.dividends,
    [
      { header: "Anexo", value: (r) => r.annex },
      { header: "Código", value: (r) => r.code },
      { header: "País", value: (r) => r.country ?? "" },
      { header: "Ativo", value: (r) => r.assetName },
      { header: "Bruto (EUR)", value: (r) => r.gross, type: "money" },
      { header: "Imposto retido (EUR)", value: (r) => r.taxWithheld, type: "money" },
      { header: "Líquido (EUR)", value: (r) => r.net, type: "money" },
    ],
    { bom: false },
  );
  const base = `${gains}\r\nDividendos ${report.year}\r\n${divs}`;
  if (report.interest.length === 0) return base;
  const interest = toCsvPt(
    report.interest,
    [
      { header: "Anexo", value: (r) => r.annex },
      { header: "Código", value: (r) => r.code },
      { header: "País", value: (r) => r.country ?? "" },
      { header: "Ativo", value: (r) => r.assetName },
      { header: "Bruto (EUR)", value: (r) => r.gross, type: "money" },
      { header: "Imposto retido (EUR)", value: (r) => r.taxWithheld, type: "money" },
      { header: "Líquido (EUR)", value: (r) => r.net, type: "money" },
    ],
    { bom: false },
  );
  return `${base}\r\nJuros P2P ${report.year}\r\n${interest}`;
}
