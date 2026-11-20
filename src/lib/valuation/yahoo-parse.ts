/**
 * Leitura das respostas do Yahoo Finance (quoteSummary, fundamentals-timeseries
 * e pesquisa) para o formato do motor. Puro e testável: a rede fica em
 * `fundamentals.server.ts`.
 */

import type {
  AnalystView,
  AnnualStatements,
  CompanyProfile,
  EarningsSurprise,
  InsiderActivity,
  MarketSnapshot,
  NewsItem,
  PeerMultiples,
  TrailingFigures,
} from "@/lib/valuation/types";

type Json = Record<string, unknown>;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Valor numérico de um campo do Yahoo ({ raw, fmt } ou número simples). */
export function raw(v: unknown): number | null {
  if (isNum(v)) return v;
  if (v && typeof v === "object" && "raw" in v) {
    const r = (v as { raw?: unknown }).raw;
    return isNum(r) ? r : null;
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});

const epochToDate = (v: unknown): string | null => {
  const n = raw(v);
  return n != null ? new Date(n * 1000).toISOString().slice(0, 10) : null;
};

/** Moedas cotadas em cêntimos (GBp, ZAc, ILA) passam para a unidade principal. */
export function normalizeCurrency(cur: string | null | undefined): {
  currency: string;
  factor: number;
} {
  const c = (cur ?? "USD").trim();
  if (c === "GBp" || c.toUpperCase() === "GBX") return { currency: "GBP", factor: 0.01 };
  if (c === "ZAc" || c.toUpperCase() === "ZAC") return { currency: "ZAR", factor: 0.01 };
  if (c.toUpperCase() === "ILA") return { currency: "ILS", factor: 0.01 };
  return { currency: c.toUpperCase(), factor: 1 };
}

/* ------------------------------------------------------------------ */
/* fundamentals-timeseries                                              */
/* ------------------------------------------------------------------ */

/** Linhas pedidas ao Yahoo (sem o prefixo annual/trailing). */
export const TIMESERIES_KEYS = [
  "TotalRevenue",
  "CostOfRevenue",
  "GrossProfit",
  "OperatingIncome",
  "EBIT",
  "EBITDA",
  "NormalizedEBITDA",
  "ReconciledDepreciation",
  "DepreciationAndAmortization",
  "InterestExpense",
  "PretaxIncome",
  "TaxProvision",
  "NetIncomeCommonStockholders",
  "NetIncome",
  "SellingGeneralAndAdministration",
  "ResearchAndDevelopment",
  "DilutedAverageShares",
  "TotalAssets",
  "CurrentAssets",
  "CurrentLiabilities",
  "TotalLiabilitiesNetMinorityInterest",
  "StockholdersEquity",
  "RetainedEarnings",
  "CashCashEquivalentsAndShortTermInvestments",
  "CashAndCashEquivalents",
  "TotalDebt",
  "CurrentDebtAndCapitalLeaseObligation",
  "CurrentDebt",
  "LongTermDebt",
  "AccountsReceivable",
  "Inventory",
  "AccountsPayable",
  "NetPPE",
  "MinorityInterest",
  "OrdinarySharesNumber",
  "OperatingCashFlow",
  "CapitalExpenditure",
  "FreeCashFlow",
  "StockBasedCompensation",
  "CashDividendsPaid",
  "RepurchaseOfCapitalStock",
  "GainOnSaleOfPPE",
  "AssetImpairmentCharge",
  "ImpairmentOfCapitalAssets",
] as const;

export const TRAILING_KEYS = [
  "TotalRevenue",
  "OperatingIncome",
  "EBITDA",
  "NetIncomeCommonStockholders",
  "OperatingCashFlow",
  "CapitalExpenditure",
  "FreeCashFlow",
] as const;

export interface ParsedTimeseries {
  periods: string[];
  annual: Record<string, (number | null)[]>;
  trailing: Record<string, number | null>;
  /** Moeda das contas (a mais frequente nos valores). */
  currency: string | null;
}

interface TsEntry {
  asOfDate?: string;
  currencyCode?: string;
  reportedValue?: { raw?: number };
}

export function parseTimeseries(json: unknown, maxYears = 4): ParsedTimeseries {
  const result = (obj(obj(json)["timeseries"])["result"] as unknown[] | undefined) ?? [];
  const annualRaw = new Map<string, Map<string, number>>();
  const trailing: Record<string, number | null> = {};
  const currencies = new Map<string, number>();
  for (const item of result) {
    const it = obj(item);
    const type = (obj(it["meta"])["type"] as string[] | undefined)?.[0];
    if (!type) continue;
    const entries = ((it[type] as TsEntry[] | undefined) ?? []).filter(
      (e) => e && typeof e.asOfDate === "string" && isNum(e.reportedValue?.raw),
    );
    for (const e of entries) {
      if (e.currencyCode) currencies.set(e.currencyCode, (currencies.get(e.currencyCode) ?? 0) + 1);
    }
    if (type.startsWith("annual")) {
      const key = type.slice("annual".length);
      const m = annualRaw.get(key) ?? new Map<string, number>();
      for (const e of entries) m.set(e.asOfDate!, e.reportedValue!.raw!);
      annualRaw.set(key, m);
    } else if (type.startsWith("trailing")) {
      const key = type.slice("trailing".length);
      const last = [...entries].sort((a, b) => (a.asOfDate! < b.asOfDate! ? -1 : 1)).pop();
      trailing[key] = last ? last.reportedValue!.raw! : null;
    }
  }
  // Anos: os da receita ou do ativo (as linhas principais), mais recentes no fim.
  const anchor = annualRaw.get("TotalRevenue") ?? annualRaw.get("TotalAssets") ?? new Map();
  let periods = [...anchor.keys()].sort();
  if (!periods.length) {
    const all = new Set<string>();
    for (const m of annualRaw.values()) for (const d of m.keys()) all.add(d);
    periods = [...all].sort();
  }
  periods = periods.slice(-maxYears);
  const annual: Record<string, (number | null)[]> = {};
  for (const [key, m] of annualRaw) annual[key] = periods.map((p) => m.get(p) ?? null);
  const currency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { periods, annual, trailing, currency };
}

export function buildStatements(ts: ParsedTimeseries, fx: number): AnnualStatements {
  const n = ts.periods.length;
  const pick = (...keys: string[]) => {
    const out: (number | null)[] = Array.from({ length: n }, () => null);
    for (let i = 0; i < n; i++) {
      for (const k of keys) {
        const v = ts.annual[k]?.[i];
        if (isNum(v)) {
          out[i] = v;
          break;
        }
      }
    }
    return out;
  };
  const money = (...keys: string[]) => pick(...keys).map((v) => (isNum(v) ? v * fx : null));
  return {
    periods: ts.periods,
    revenue: money("TotalRevenue"),
    costOfRevenue: money("CostOfRevenue"),
    grossProfit: money("GrossProfit"),
    operatingIncome: money("OperatingIncome", "EBIT"),
    ebitda: money("EBITDA", "NormalizedEBITDA"),
    normalizedEbitda: money("NormalizedEBITDA"),
    impairments: money("AssetImpairmentCharge", "ImpairmentOfCapitalAssets"),
    depreciation: money("ReconciledDepreciation", "DepreciationAndAmortization"),
    interestExpense: money("InterestExpense"),
    pretaxIncome: money("PretaxIncome"),
    taxProvision: money("TaxProvision"),
    netIncome: money("NetIncomeCommonStockholders", "NetIncome"),
    sga: money("SellingGeneralAndAdministration"),
    rnd: money("ResearchAndDevelopment"),
    dilutedShares: pick("DilutedAverageShares"),
    totalAssets: money("TotalAssets"),
    currentAssets: money("CurrentAssets"),
    currentLiabilities: money("CurrentLiabilities"),
    totalLiabilities: money("TotalLiabilitiesNetMinorityInterest"),
    equity: money("StockholdersEquity"),
    retainedEarnings: money("RetainedEarnings"),
    cash: money("CashCashEquivalentsAndShortTermInvestments", "CashAndCashEquivalents"),
    totalDebt: money("TotalDebt"),
    currentDebt: money("CurrentDebtAndCapitalLeaseObligation", "CurrentDebt"),
    longTermDebt: money("LongTermDebt"),
    receivables: money("AccountsReceivable"),
    inventory: money("Inventory"),
    payables: money("AccountsPayable"),
    netPPE: money("NetPPE"),
    minorityInterest: money("MinorityInterest"),
    sharesOutstanding: pick("OrdinarySharesNumber"),
    operatingCashFlow: money("OperatingCashFlow"),
    capex: money("CapitalExpenditure"),
    freeCashFlow: money("FreeCashFlow"),
    stockCompensation: money("StockBasedCompensation"),
    dividendsPaid: money("CashDividendsPaid"),
    buybacks: money("RepurchaseOfCapitalStock"),
    gainOnSale: money("GainOnSaleOfPPE"),
  };
}

export function buildTrailing(ts: ParsedTimeseries, fx: number): TrailingFigures {
  const t = (k: string) => (isNum(ts.trailing[k]) ? ts.trailing[k]! * fx : null);
  return {
    revenue: t("TotalRevenue"),
    operatingIncome: t("OperatingIncome"),
    ebitda: t("EBITDA"),
    netIncome: t("NetIncomeCommonStockholders"),
    operatingCashFlow: t("OperatingCashFlow"),
    capex: t("CapitalExpenditure"),
    freeCashFlow: t("FreeCashFlow"),
  };
}

/* ------------------------------------------------------------------ */
/* quoteSummary                                                         */
/* ------------------------------------------------------------------ */

export function summaryResult(json: unknown): Json | null {
  const r = (obj(obj(json)["quoteSummary"])["result"] as unknown[] | undefined)?.[0];
  return r && typeof r === "object" ? (r as Json) : null;
}

export interface SummaryBasics {
  priceCurrency: string;
  factor: number;
  financialCurrency: string;
  price: number;
}

export function summaryBasics(q: Json): SummaryBasics | null {
  const price = obj(q["price"]);
  const p = raw(price["regularMarketPrice"]);
  if (!isNum(p) || p <= 0) return null;
  const { currency, factor } = normalizeCurrency(str(price["currency"]));
  const fin = str(obj(q["financialData"])["financialCurrency"]) ?? currency;
  return {
    priceCurrency: currency,
    factor,
    financialCurrency: fin.toUpperCase(),
    price: p * factor,
  };
}

export function buildProfile(
  symbol: string,
  q: Json,
  financialCurrency: string,
  fxToPrice: number,
): CompanyProfile {
  const price = obj(q["price"]);
  const ap = obj(q["assetProfile"]);
  return {
    symbol,
    name: str(price["longName"]) ?? str(price["shortName"]) ?? symbol,
    exchange: str(price["exchangeName"]),
    quoteType: str(price["quoteType"]),
    sector: str(ap["sector"]),
    industry: str(ap["industry"]),
    country: str(ap["country"]),
    summary: str(ap["longBusinessSummary"]),
    website: str(ap["website"]),
    employees: raw(ap["fullTimeEmployees"]),
    financialCurrency,
    fxToPrice,
  };
}

export function buildMarket(q: Json, basics: SummaryBasics): MarketSnapshot {
  const price = obj(q["price"]);
  const sd = obj(q["summaryDetail"]);
  const ks = obj(q["defaultKeyStatistics"]);
  const ce = obj(obj(q["calendarEvents"])["earnings"]);
  const f = basics.factor;
  const sharesOut = raw(ks["sharesOutstanding"]);
  let marketCap = raw(price["marketCap"]) ?? raw(sd["marketCap"]);
  if (!isNum(marketCap) && isNum(sharesOut)) marketCap = sharesOut * basics.price;
  marketCap ??= 0;
  // Correção de cêntimos: se a capitalização implicar 100× as ações, está noutra unidade.
  if (isNum(sharesOut) && sharesOut > 0 && marketCap > 0) {
    const ratio = marketCap / basics.price / sharesOut;
    if (ratio > 80 && ratio < 120) marketCap /= 100;
    else if (ratio > 0.008 && ratio < 0.012) marketCap *= 100;
  }
  const yieldFwd = raw(sd["dividendYield"]);
  const rate = raw(sd["dividendRate"]);
  const nextEarnings = (ce["earningsDate"] as unknown[] | undefined)?.[0];
  const scale = (v: number | null) => (isNum(v) ? v * f : null);
  return {
    price: basics.price,
    currency: basics.priceCurrency,
    marketCap,
    shares: marketCap > 0 ? marketCap / basics.price : (sharesOut ?? 0),
    beta: raw(sd["beta"]) ?? raw(ks["beta"]),
    trailingPE: raw(sd["trailingPE"]),
    forwardPE: raw(sd["forwardPE"]) ?? raw(ks["forwardPE"]),
    priceToBook: raw(ks["priceToBook"]),
    dividendRate:
      isNum(yieldFwd) && yieldFwd > 0
        ? yieldFwd * basics.price
        : isNum(rate) && rate > 0
          ? rate * f
          : null,
    dividendYield: isNum(yieldFwd) ? yieldFwd : null,
    payoutRatio: raw(sd["payoutRatio"]),
    fiftyTwoWeekHigh: scale(raw(sd["fiftyTwoWeekHigh"])),
    fiftyTwoWeekLow: scale(raw(sd["fiftyTwoWeekLow"])),
    exDividendDate: epochToDate(sd["exDividendDate"]),
    nextEarningsDate: epochToDate(nextEarnings),
  };
}

export function buildAnalysts(q: Json, factor: number): AnalystView {
  const fd = obj(q["financialData"]);
  const trend = ((obj(q["earningsTrend"])["trend"] as unknown[] | undefined) ?? []).map(obj);
  const byPeriod = (p: string) => trend.find((t) => t["period"] === p) ?? {};
  const cur = byPeriod("0y");
  const next = byPeriod("+1y");
  const rec = ((obj(q["recommendationTrend"])["trend"] as unknown[] | undefined) ?? []).map(obj);
  const r0 = rec.find((t) => t["period"] === "0m");
  const scale = (v: number | null) => (isNum(v) ? v * factor : null);
  return {
    targetMean: scale(raw(fd["targetMeanPrice"])),
    targetHigh: scale(raw(fd["targetHighPrice"])),
    targetLow: scale(raw(fd["targetLowPrice"])),
    count: raw(fd["numberOfAnalystOpinions"]),
    recommendationKey: str(fd["recommendationKey"]),
    recommendationMean: raw(fd["recommendationMean"]),
    revenueGrowthNextYear: raw(obj(next["revenueEstimate"])["growth"]),
    revenueGrowthCurrentYear: raw(obj(cur["revenueEstimate"])["growth"]),
    epsGrowthNextYear: raw(next["growth"]),
    epsGrowthCurrentYear: raw(cur["growth"]),
    ratings: r0
      ? {
          strongBuy: raw(r0["strongBuy"]) ?? 0,
          buy: raw(r0["buy"]) ?? 0,
          hold: raw(r0["hold"]) ?? 0,
          sell: raw(r0["sell"]) ?? 0,
          strongSell: raw(r0["strongSell"]) ?? 0,
        }
      : null,
  };
}

export function buildEarnings(q: Json): EarningsSurprise[] {
  const hist = ((obj(q["earningsHistory"])["history"] as unknown[] | undefined) ?? []).map(obj);
  return hist
    .map((h) => ({
      period: epochToDate(h["quarter"]) ?? "",
      estimate: raw(h["epsEstimate"]),
      actual: raw(h["epsActual"]),
      surprisePct: raw(h["surprisePercent"]),
    }))
    .filter((h) => h.period)
    .sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function buildInsiders(q: Json): InsiderActivity {
  const n = obj(q["netSharePurchaseActivity"]);
  const ks = obj(q["defaultKeyStatistics"]);
  const tx = ((obj(q["insiderTransactions"])["transactions"] as unknown[] | undefined) ?? []).map(
    obj,
  );
  return {
    buyShares: raw(n["buyInfoShares"]),
    sellShares: raw(n["sellInfoShares"]),
    netShares: raw(n["netInfoShares"]),
    buyCount: raw(n["buyInfoCount"]),
    sellCount: raw(n["sellInfoCount"]),
    heldPct: raw(ks["heldPercentInsiders"]),
    transactions: tx.slice(0, 15).map((t) => ({
      date: epochToDate(t["startDate"]),
      name: str(t["filerName"]) ?? "—",
      relation: str(t["filerRelation"]),
      text: str(t["transactionText"]),
      shares: raw(t["shares"]),
      value: raw(t["value"]),
    })),
  };
}

export function peerFromSummary(symbol: string, q: Json): PeerMultiples {
  const price = obj(q["price"]);
  const sd = obj(q["summaryDetail"]);
  const ks = obj(q["defaultKeyStatistics"]);
  const fd = obj(q["financialData"]);
  const ap = obj(q["assetProfile"]);
  const ev = raw(ks["enterpriseValue"]);
  const opMargin = raw(fd["operatingMargins"]);
  const revenue = raw(fd["totalRevenue"]);
  const ebit = isNum(opMargin) && isNum(revenue) ? opMargin * revenue : null;
  return {
    symbol,
    name: str(price["shortName"]) ?? str(price["longName"]) ?? symbol,
    sector: str(ap["sector"]),
    industry: str(ap["industry"]),
    marketCap: raw(price["marketCap"]),
    pe: raw(sd["trailingPE"]),
    forwardPe: raw(sd["forwardPE"]) ?? raw(ks["forwardPE"]),
    evEbitda: raw(ks["enterpriseToEbitda"]),
    evEbit: isNum(ev) && isNum(ebit) && ebit > 0 ? ev / ebit : null,
    evSales: raw(ks["enterpriseToRevenue"]),
    pb: raw(ks["priceToBook"]),
  };
}

/* ------------------------------------------------------------------ */
/* Pesquisa, notícias e BCE                                             */
/* ------------------------------------------------------------------ */

export interface SymbolHit {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string;
}

export function parseSearchQuotes(json: unknown): SymbolHit[] {
  const quotes = ((obj(json)["quotes"] as unknown[] | undefined) ?? []).map(obj);
  return quotes
    .filter((q) => q["quoteType"] === "EQUITY" && str(q["symbol"]))
    .map((q) => ({
      symbol: str(q["symbol"])!,
      name: str(q["longname"]) ?? str(q["shortname"]) ?? str(q["symbol"])!,
      exchange: str(q["exchDisp"]) ?? str(q["exchange"]),
      type: "Ação",
    }));
}

export function parseSearchNews(json: unknown): NewsItem[] {
  const news = ((obj(json)["news"] as unknown[] | undefined) ?? []).map(obj);
  return news
    .filter((n) => str(n["title"]) && str(n["link"]))
    .map((n) => ({
      title: str(n["title"])!,
      publisher: str(n["publisher"]),
      url: str(n["link"])!,
      publishedAt: (() => {
        const t = raw(n["providerPublishTime"]);
        return t != null ? new Date(t * 1000).toISOString() : null;
      })(),
    }));
}

/** Último valor (em %) do CSV da API de dados do BCE. */
export function parseEcbCsv(text: string): number | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const head = lines[0]!.split(",");
  const iv = head.indexOf("OBS_VALUE");
  const it = head.indexOf("TIME_PERIOD");
  if (iv < 0) return null;
  const rows = lines.slice(1).map((l) => l.split(","));
  rows.sort((a, b) => ((a[it] ?? "") < (b[it] ?? "") ? -1 : 1));
  const v = Number(rows[rows.length - 1]?.[iv]);
  return Number.isFinite(v) ? v : null;
}
