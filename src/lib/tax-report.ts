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

/** Juros e bónus de plataformas estrangeiras (P2P), já em EUR. */
export interface InterestRecord {
  assetId: string | null;
  assetName: string;
  /** Data do pagamento (YYYY-MM-DD). */
  date: string;
  amount: number;
  /** ISO-2 do país da fonte (para a Scramble, EE — Estónia). */
  country: string | null;
  kind: "interest" | "bonus";
  taxWithheld?: number;
}

export interface InterestTaxLine {
  assetId: string | null;
  assetName: string;
  country: string | null;
  /** J = estrangeiro (quadro 8A, código E21 — juros sem retenção em PT). */
  annex: Annex;
  code: "E21";
  gross: number;
  taxWithheld: number;
  net: number;
  count: number;
}

export interface TaxReport {
  year: number;
  capitalGains: CapitalGainLine[];
  dividends: DividendTaxLine[];
  /** Juros P2P recebidos no ano (Anexo J, quadro 8A, código E21). */
  interest: InterestTaxLine[];
  /** Bónus recebidos no ano: enquadramento fiscal a confirmar. */
  bonuses: Array<{ assetId: string | null; assetName: string; amount: number }>;
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
    interestGross: number;
    bonuses: number;
  };
  /** Estimativa com tributação autónoma a 28% (com crédito de imposto estrangeiro). */
  autonomous: {
    capitalGainsTax: number;
    dividendsTaxPt: number;
    foreignTaxCredit: number;
    dividendsTaxDue: number;
    /** Juros estrangeiros a 28% (menos o imposto retido lá fora, se houver). */
    interestTaxDue: number;
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
  /** Juros e bónus P2P (opcional). */
  interest?: InterestRecord[];
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

  /* ---------------- Juros P2P (pela data de pagamento) ---------------- */
  const interestMap = new Map<string, InterestTaxLine>();
  const bonusMap = new Map<string, { assetId: string | null; assetName: string; amount: number }>();
  for (const r of input.interest ?? []) {
    if (!r.date.startsWith(y) || r.date > today) continue;
    const key = r.assetId ?? `name:${r.assetName}`;
    if (r.kind === "bonus") {
      const b = bonusMap.get(key) ?? { assetId: r.assetId, assetName: r.assetName, amount: 0 };
      b.amount += r.amount;
      bonusMap.set(key, b);
      continue;
    }
    const line = interestMap.get(key) ?? {
      assetId: r.assetId,
      assetName: r.assetName,
      country: r.country,
      annex: "J" as Annex,
      code: "E21" as const,
      gross: 0,
      taxWithheld: 0,
      net: 0,
      count: 0,
    };
    line.gross += r.amount;
    line.taxWithheld += r.taxWithheld ?? 0;
    line.net += r.amount - (r.taxWithheld ?? 0);
    line.count += 1;
    interestMap.set(key, line);
  }
  const interestLines = [...interestMap.values()]
    .map((l) => ({
      ...l,
      gross: round2(l.gross),
      taxWithheld: round2(l.taxWithheld),
      net: round2(l.net),
    }))
    .filter((l) => l.gross > 0)
    .sort((a, b) => b.gross - a.gross);
  const bonusLines = [...bonusMap.values()]
    .map((b) => ({ ...b, amount: round2(b.amount) }))
    .filter((b) => b.amount > 0);
  if (bonusLines.length > 0) {
    warnings.push(
      "Recebeste bónus de plataformas P2P, que a plataforma não trata como juros: confirma o enquadramento no Portal das Finanças antes de os declarar.",
    );
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
    interestGross: sum(interestLines, (l) => l.gross),
    bonuses: sum(bonusLines, (b) => b.amount),
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
  // Juros sem retenção em Portugal: 28%, com crédito do imposto retido lá fora.
  const interestTaxDue = round2(
    interestLines.reduce(
      (s, l) =>
        s + l.gross * PT_AUTONOMOUS_RATE - Math.min(l.taxWithheld, l.gross * PT_AUTONOMOUS_RATE),
      0,
    ),
  );

  let aggregated: TaxReport["aggregated"] = null;
  const mr = input.marginalRate;
  if (typeof mr === "number" && mr >= 0 && mr < 1) {
    // Englobamento: dividendos de fonte UE/EEE contam 50%; mais-valias 100%.
    const divBase = dividendLines.reduce(
      (s, l) => s + l.gross * (l.country && EU_EEA.has(l.country) ? 0.5 : 1),
      0,
    );
    // Juros contam a 100%.
    const interestBase = interestLines.reduce((s, l) => s + l.gross, 0);
    const allCredit =
      dividendLines.reduce((s, l) => s + l.taxWithheld, 0) +
      interestLines.reduce((s, l) => s + l.taxWithheld, 0);
    const total = Math.max(0, (Math.max(0, netGains) + divBase + interestBase) * mr - allCredit);
    aggregated = { marginalRate: mr, total: round2(total) };
  }

  return {
    year,
    capitalGains,
    dividends: dividendLines,
    interest: interestLines,
    bonuses: bonusLines,
    totals,
    autonomous: {
      capitalGainsTax,
      dividendsTaxPt,
      foreignTaxCredit,
      dividendsTaxDue,
      interestTaxDue,
      total: round2(capitalGainsTax + dividendsTaxDue + interestTaxDue),
    },
    aggregated,
    warnings,
  };
}
