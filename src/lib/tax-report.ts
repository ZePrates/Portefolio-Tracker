/**
 * Resumo fiscal anual para um residente em Portugal (IRS) — lógica pura.
 *
 * ⚠️ Ferramenta de apoio ao preenchimento, não aconselhamento fiscal. Os
 * códigos e quadros indicados são os habituais para quem investe através de
 * um broker estrangeiro (ex.: XTB); confirma sempre no Portal das Finanças.
 *
 * Mais-valias: uma linha por lote FIFO consumido (o IRS pede data e valor de
 * aquisição por lote), com valores em EUR ao câmbio de cada data.
 * Dividendos: por ativo/país, bruto, imposto retido no estrangeiro e líquido.
 */

import { replayLedger, type LedgerEntry } from "@/lib/fifo";
import { grossOf, isReceived, netOf, taxOf, type DividendRecord } from "@/lib/dividends";
import { domicileOf, type TaxableAsset } from "@/lib/tax";

/** Taxa especial (autónoma) de mais-valias e rendimentos de capitais. */
export const PT_AUTONOMOUS_RATE = 0.28;

/** UE/EEE: dividendos englobados contam só 50% (art. 40.º-A CIRS). */
const EU_EEA = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
]);

export interface TaxReportAsset extends TaxableAsset {
  id: string;
  name: string;
}

export interface TaxReportTransaction extends LedgerEntry {
  asset_id: string | null;
}

export interface TaxReportDividend extends DividendRecord {
  tax_amount?: number | null;
  payment_date_estimated?: boolean | null;
}

export type Annex = "G" | "J" | "E";

export interface CapitalGainLine {
  assetId: string;
  assetName: string;
  isin: string | null;
  country: string | null;
  /** G = título nacional; J = título estrangeiro (quadro 9.2A). */
  annex: Annex;
  /** G01 ações; G20 unidades de participação em fundos (ETFs). */
  code: "G01" | "G20";
  acquisitionDate: string;
  realizationDate: string;
  quantity: number;
  /** Valor de aquisição (EUR), sem encargos. */
  acquisitionValue: number;
  /** Valor de realização (EUR), sem encargos. */
  realizationValue: number;
  /** Despesas e encargos (comissões de compra e venda imputáveis, EUR). */
  expenses: number;
  gain: number;
  /** Detido menos de 365 dias (relevante para o englobamento obrigatório). */
  shortTerm: boolean;
}

export interface DividendTaxLine {
  assetId: string | null;
  assetName: string;
  country: string | null;
  /** J = estrangeiro (quadro 8A, código E11); E = nacional (retenção liberatória). */
  annex: Annex;
  code: "E11" | "E10";
  gross: number;
  /** Imposto retido no estrangeiro / na fonte (EUR). */
  taxWithheld: number;
  net: number;
  count: number;
  /** Há registos com data de pagamento estimada (confirmar com o extrato). */
  hasEstimatedDates: boolean;
}

export interface TaxReport {
  year: number;
  capitalGains: CapitalGainLine[];
  dividends: DividendTaxLine[];
  totals: {
    realizationValue: number;
    acquisitionValue: number;
    expenses: number;
    /** Saldo de mais-valias (ganhos − perdas). */
    netGains: number;
    shortTermNetGains: number;
    dividendsGross: number;
    dividendsTaxWithheld: number;
    dividendsNet: number;
  };
  /** Estimativa com tributação autónoma a 28% (com crédito de imposto estrangeiro). */
  autonomous: {
    capitalGainsTax: number;
    dividendsTaxPt: number;
    foreignTaxCredit: number;
    dividendsTaxDue: number;
    total: number;
  };
  /** Estimativa com englobamento, se for indicada a taxa marginal. */
  aggregated: { marginalRate: number; total: number } | null;
  warnings: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

export function annualTaxReport(input: {
  year: number;
  assets: TaxReportAsset[];
  transactions: TaxReportTransaction[];
  dividends: TaxReportDividend[];
  today: string;
  /** Taxa marginal de IRS (0..1) para simular o englobamento. */
  marginalRate?: number | null;
}): TaxReport {
  const { year, assets, transactions, dividends, today } = input;
  const y = String(year);
  const warnings: string[] = [];
  const assetById = new Map(assets.map((a) => [a.id, a]));

  /* ---------------- Mais-valias (FIFO por lote) ---------------- */
  const byAsset = new Map<string, TaxReportTransaction[]>();
  for (const t of transactions) {
    if (!t.asset_id) continue;
    const list = byAsset.get(t.asset_id) ?? [];
    list.push(t);
    byAsset.set(t.asset_id, list);
  }

  const capitalGains: CapitalGainLine[] = [];
  for (const [assetId, entries] of byAsset) {
    const asset = assetById.get(assetId);
    if (!asset) continue;
    const salesInYear = entries.some((e) => e.type === "sell" && e.traded_at.startsWith(y));
    if (!salesInYear) continue;

    const buys = new Map(entries.filter((e) => e.type === "buy" && e.id).map((e) => [e.id!, e]));
    let replay;
    try {
      replay = replayLedger(entries);
    } catch (e) {
      warnings.push(`${asset.name}: ${e instanceof Error ? e.message : "livro inválido"}`);
      continue;
    }
    const country = domicileOf(asset);
    const annex: Annex = country === "PT" ? "G" : "J";
    const code = asset.class === "etf" ? "G20" : "G01";

    for (const sale of replay.sales) {
      if (!sale.traded_at.startsWith(y)) continue;
      const salePrice = sale.quantity > 0 ? sale.proceeds / sale.quantity : 0;
      for (const part of sale.breakdown) {
        const buy = part.lotId ? buys.get(part.lotId) : undefined;
        const buyQty = Number(buy?.quantity) || 0;
        const buyPrice = buy ? Number(buy.price) || 0 : part.unitCost;
        const buyFee =
          buy && buyQty > 0 ? ((Number(buy.fee ?? 0) || 0) * part.quantity) / buyQty : 0;
        const sellFee = sale.quantity > 0 ? (sale.fee * part.quantity) / sale.quantity : 0;
        const acquisitionValue = buyPrice * part.quantity;
        const realizationValue = salePrice * part.quantity;
        const expenses = buyFee + sellFee;
        capitalGains.push({
          assetId,
          assetName: asset.name,
          isin: asset.isin ?? null,
          country,
          annex,
          code,
          acquisitionDate: part.traded_at,
          realizationDate: sale.traded_at,
          quantity: part.quantity,
          acquisitionValue: round2(acquisitionValue),
          realizationValue: round2(realizationValue),
          expenses: round2(expenses),
          gain: round2(realizationValue - acquisitionValue - expenses),
          shortTerm: daysBetween(part.traded_at, sale.traded_at) < 365,
        });
      }
    }
  }
  capitalGains.sort(
    (a, b) =>
      a.realizationDate.localeCompare(b.realizationDate) || a.assetName.localeCompare(b.assetName),
  );

  /* ---------------- Dividendos (pela data de pagamento) ---------------- */
  const divMap = new Map<string, DividendTaxLine>();
  for (const d of dividends) {
    if (!isReceived(d, today)) continue;
    const payDate = (d.payment_date ?? d.paid_at).slice(0, 10);
    if (!payDate.startsWith(y)) continue;
    const asset = d.asset_id ? assetById.get(d.asset_id) : undefined;
    const country = asset ? domicileOf(asset) : null;
    const key = d.asset_id ?? `name:${d.asset_name}`;
    const line = divMap.get(key) ?? {
      assetId: d.asset_id,
      assetName: d.asset_name,
      country,
      annex: country === "PT" ? "E" : "J",
      code: country === "PT" ? "E10" : "E11",
      gross: 0,
      taxWithheld: 0,
      net: 0,
      count: 0,
      hasEstimatedDates: false,
    };
    line.gross += grossOf(d);
    line.taxWithheld += taxOf(d);
    line.net += netOf(d);
    line.count += 1;
    line.hasEstimatedDates ||= !!d.payment_date_estimated;
    divMap.set(key, line);
  }
  const dividendLines = [...divMap.values()]
    .map((l) => ({
      ...l,
      gross: round2(l.gross),
      taxWithheld: round2(l.taxWithheld),
      net: round2(l.net),
    }))
    .sort((a, b) => b.gross - a.gross);
  if (dividendLines.some((l) => l.hasEstimatedDates)) {
    warnings.push(
      "Há dividendos com data de pagamento estimada: confirma o ano com o extrato do broker.",
    );
  }
  if (dividendLines.some((l) => l.country == null)) {
    warnings.push("Há dividendos de ativos com país desconhecido.");
  }

  /* ---------------- Totais e estimativas ---------------- */
  const sum = <T>(rows: T[], f: (r: T) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
  const netGains = sum(capitalGains, (l) => l.gain);
  const totals = {
    realizationValue: sum(capitalGains, (l) => l.realizationValue),
    acquisitionValue: sum(capitalGains, (l) => l.acquisitionValue),
    expenses: sum(capitalGains, (l) => l.expenses),
    netGains,
    shortTermNetGains: sum(
      capitalGains.filter((l) => l.shortTerm),
      (l) => l.gain,
    ),
    dividendsGross: sum(dividendLines, (l) => l.gross),
    dividendsTaxWithheld: sum(dividendLines, (l) => l.taxWithheld),
    dividendsNet: sum(dividendLines, (l) => l.net),
  };

  // Dividendos estrangeiros: 28% em PT, com crédito do imposto pago lá fora
  // (limitado ao imposto português). Nacionais: retenção liberatória já feita.
  const foreign = dividendLines.filter((l) => l.annex === "J");
  const dividendsTaxPt = round2(foreign.reduce((s, l) => s + l.gross * PT_AUTONOMOUS_RATE, 0));
  const foreignTaxCredit = round2(
    foreign.reduce((s, l) => s + Math.min(l.taxWithheld, l.gross * PT_AUTONOMOUS_RATE), 0),
  );
  const capitalGainsTax = round2(Math.max(0, netGains) * PT_AUTONOMOUS_RATE);
  const dividendsTaxDue = round2(dividendsTaxPt - foreignTaxCredit);

  let aggregated: TaxReport["aggregated"] = null;
  const mr = input.marginalRate;
  if (typeof mr === "number" && mr >= 0 && mr < 1) {
    // Englobamento: dividendos de fonte UE/EEE contam 50%; mais-valias 100%.
    const divBase = dividendLines.reduce(
      (s, l) => s + l.gross * (l.country && EU_EEA.has(l.country) ? 0.5 : 1),
      0,
    );
    const allCredit = dividendLines.reduce((s, l) => s + l.taxWithheld, 0);
    const total = Math.max(0, (Math.max(0, netGains) + divBase) * mr - allCredit);
    aggregated = { marginalRate: mr, total: round2(total) };
  }

  return {
    year,
    capitalGains,
    dividends: dividendLines,
    totals,
    autonomous: {
      capitalGainsTax,
      dividendsTaxPt,
      foreignTaxCredit,
      dividendsTaxDue,
      total: round2(capitalGainsTax + dividendsTaxDue),
    },
    aggregated,
    warnings,
  };
}
