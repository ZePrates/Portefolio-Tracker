/**
 * Contrato de dados da avaliação de empresas.
 *
 * O servidor (`fundamentals.server.ts`) recolhe e normaliza os dados públicos;
 * o motor (`analyze.ts`) corre no browser, para os pressupostos poderem ser
 * alterados sem novo pedido. Todos os valores monetários já vêm na moeda da
 * cotação (as contas em TWD de uma ADR em USD chegam convertidas para USD).
 */

import type { Series } from "@/lib/valuation/stats";

export type { Series };

/** Demonstrações financeiras anuais (do ano mais antigo para o mais recente). */
export interface AnnualStatements {
  /** Data de fecho de cada ano fiscal (YYYY-MM-DD). */
  periods: string[];
  // Demonstração de resultados
  revenue: Series;
  costOfRevenue: Series;
  grossProfit: Series;
  operatingIncome: Series;
  ebitda: Series;
  /** EBITDA sem itens extraordinários (imparidades, reestruturações). */
  normalizedEbitda: Series;
  /** Imparidades de ativos (custo sem saída de caixa). */
  impairments: Series;
  depreciation: Series;
  interestExpense: Series;
  pretaxIncome: Series;
  taxProvision: Series;
  netIncome: Series;
  sga: Series;
  rnd: Series;
  dilutedShares: Series;
  // Balanço
  totalAssets: Series;
  currentAssets: Series;
  currentLiabilities: Series;
  totalLiabilities: Series;
  equity: Series;
  retainedEarnings: Series;
  cash: Series;
  totalDebt: Series;
  /** Dívida de curto prazo (inclui locações). */
  currentDebt: Series;
  longTermDebt: Series;
  receivables: Series;
  inventory: Series;
  payables: Series;
  netPPE: Series;
  minorityInterest: Series;
  sharesOutstanding: Series;
  // Fluxos de caixa
  operatingCashFlow: Series;
  capex: Series;
  freeCashFlow: Series;
  stockCompensation: Series;
  dividendsPaid: Series;
  buybacks: Series;
  gainOnSale: Series;
}

/** Últimos 12 meses (quando o Yahoo os publica); null se não houver. */
export interface TrailingFigures {
  revenue: number | null;
  operatingIncome: number | null;
  ebitda: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
}

export interface CompanyProfile {
  symbol: string;
  name: string;
  exchange: string | null;
  quoteType: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  summary: string | null;
  website: string | null;
  employees: number | null;
  /** Moeda em que a empresa reporta as contas (antes da conversão). */
  financialCurrency: string;
  /** 1 unidade da moeda das contas = `fxToPrice` unidades da moeda da cotação. */
  fxToPrice: number;
}

export interface MarketSnapshot {
  price: number;
  /** Moeda da cotação, já normalizada (GBp → GBP). */
  currency: string;
  marketCap: number;
  /** Ações implícitas = capitalização / preço (lida bem com ADR e cêntimos). */
  shares: number;
  beta: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  /** Dividendo anual por ação (na moeda da cotação). */
  dividendRate: number | null;
  dividendYield: number | null;
  payoutRatio: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  exDividendDate: string | null;
  nextEarningsDate: string | null;
}

export interface AnalystView {
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  count: number | null;
  recommendationKey: string | null;
  /** 1 = compra forte … 5 = venda. */
  recommendationMean: number | null;
  /** Crescimento esperado da receita no próximo ano fiscal. */
  revenueGrowthNextYear: number | null;
  revenueGrowthCurrentYear: number | null;
  epsGrowthNextYear: number | null;
  epsGrowthCurrentYear: number | null;
  /** Distribuição das recomendações do mês corrente. */
  ratings: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  } | null;
}

export interface EarningsSurprise {
  /** Trimestre (YYYY-MM-DD do fecho). */
  period: string;
  estimate: number | null;
  actual: number | null;
  surprisePct: number | null;
}

export interface InsiderTransaction {
  date: string | null;
  name: string;
  relation: string | null;
  text: string | null;
  shares: number | null;
  value: number | null;
}

export interface InsiderActivity {
  /** Últimos 6 meses (resumo do Yahoo). */
  buyShares: number | null;
  sellShares: number | null;
  netShares: number | null;
  buyCount: number | null;
  sellCount: number | null;
  /** Ações detidas por insiders em % do total. */
  heldPct: number | null;
  transactions: InsiderTransaction[];
}

export interface PeerMultiples {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  pe: number | null;
  forwardPe: number | null;
  evEbitda: number | null;
  evEbit: number | null;
  evSales: number | null;
  pb: number | null;
}

export interface MacroSnapshot {
  /** Taxa sem risco a 10 anos na moeda da cotação. */
  riskFree: number;
  riskFreeLabel: string;
  us10y: number | null;
  euro10y: number | null;
  /** P/E dos últimos 12 meses do S&P 500 (via SPY). */
  sp500PE: number | null;
}

export interface PricePoint {
  date: string;
  close: number;
}

export interface NewsItem {
  title: string;
  publisher: string | null;
  url: string;
  publishedAt: string | null;
}

/** Tudo o que o motor precisa para avaliar uma empresa. */
export interface CompanyData {
  profile: CompanyProfile;
  market: MarketSnapshot;
  statements: AnnualStatements;
  trailing: TrailingFigures;
  analysts: AnalystView;
  earnings: EarningsSurprise[];
  insiders: InsiderActivity;
  peers: PeerMultiples[];
  peerSource: "finnhub" | "yahoo" | "none";
  macro: MacroSnapshot;
  /** Fechos diários dos últimos 12 meses. */
  priceHistory: PricePoint[];
  news: NewsItem[];
  fetchedAt: string;
  /** Avisos de recolha (dados em falta, conversões). */
  warnings: string[];
}

/** Um passo de cálculo explicado ao utilizador. */
export interface CalcStep {
  label: string;
  /** Fórmula ou origem do número, em texto simples. */
  formula?: string;
  value: number | string | null;
  format?: "pct" | "money" | "number" | "multiple" | "text" | "big";
  note?: string;
}
