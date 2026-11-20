/** Empresa fictícia para os testes do motor de avaliação (números redondos). */

import type { AnnualStatements, CompanyData, PeerMultiples } from "@/lib/valuation/types";

export function makeStatements(over: Partial<AnnualStatements> = {}): AnnualStatements {
  return {
    periods: ["2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"],
    revenue: [800, 880, 968, 1064.8],
    costOfRevenue: [480, 528, 580.8, 638.88],
    grossProfit: [320, 352, 387.2, 425.92],
    operatingIncome: [160, 176, 193.6, 212.96],
    ebitda: [200, 220, 242, 266.2],
    normalizedEbitda: [null, null, null, null],
    impairments: [0, 0, 0, 0],
    depreciation: [40, 44, 48.4, 53.24],
    interestExpense: [10, 10, 10, 10],
    pretaxIncome: [150, 166, 183.6, 202.96],
    taxProvision: [31.5, 34.86, 38.556, 42.6216],
    netIncome: [118.5, 131.14, 145.044, 160.3384],
    sga: [100, 110, 121, 133.1],
    rnd: [null, null, null, null],
    dilutedShares: [100, 100, 100, 100],
    totalAssets: [1000, 1080, 1166, 1260],
    currentAssets: [400, 430, 465, 500],
    currentLiabilities: [200, 210, 220, 230],
    totalLiabilities: [500, 520, 540, 560],
    equity: [500, 560, 626, 700],
    retainedEarnings: [300, 360, 426, 500],
    cash: [100, 110, 120, 130],
    totalDebt: [200, 200, 200, 200],
    currentDebt: [20, 20, 20, 20],
    longTermDebt: [180, 180, 180, 180],
    receivables: [120, 130, 140, 150],
    inventory: [100, 105, 110, 115],
    payables: [80, 85, 90, 95],
    netPPE: [400, 430, 460, 490],
    minorityInterest: [0, 0, 0, 0],
    sharesOutstanding: [100, 100, 100, 100],
    operatingCashFlow: [170, 185, 200, 220],
    capex: [-60, -65, -70, -75],
    freeCashFlow: [110, 120, 130, 145],
    stockCompensation: [10, 11, 12, 13],
    dividendsPaid: [-40, -44, -48, -52],
    buybacks: [-20, -20, -20, -20],
    gainOnSale: [0, 0, 0, 0],
    ...over,
  };
}

export function makePeers(): PeerMultiples[] {
  const pe = [15, 18, 20, 22, 120];
  const forwardPe = [14, 16, 18, 19, 20];
  const evEbitda = [10, 11, 12, 13, 14];
  const evEbit = [14, 15, 16, 17, 18];
  const evSales = [2, 2.5, 3, 3.5, 4];
  const pb = [3, 3.5, 4, 4.5, 5];
  return pe.map((_, i) => ({
    symbol: `P${i + 1}`,
    name: `Par ${i + 1}`,
    sector: "Consumer Defensive",
    industry: "Packaged Foods",
    marketCap: 1000 * (i + 1),
    pe: pe[i]!,
    forwardPe: forwardPe[i]!,
    evEbitda: evEbitda[i]!,
    evEbit: evEbit[i]!,
    evSales: evSales[i]!,
    pb: pb[i]!,
  }));
}

export function makeCompany(over: Partial<CompanyData> = {}): CompanyData {
  const statements = over.statements ?? makeStatements();
  const priceHistory = Array.from({ length: 252 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 2 + i)).toISOString().slice(0, 10),
    close: 25 + (5 * i) / 251,
  }));
  return {
    profile: {
      symbol: "TEST",
      name: "Empresa Teste",
      exchange: "NYSE",
      quoteType: "EQUITY",
      sector: "Consumer Defensive",
      industry: "Packaged Foods",
      country: "United States",
      summary: null,
      website: null,
      employees: 1000,
      financialCurrency: "USD",
      fxToPrice: 1,
    },
    market: {
      price: 30,
      currency: "USD",
      marketCap: 3000,
      shares: 100,
      beta: 1.1,
      trailingPE: 3000 / 160.3384,
      forwardPE: 16,
      priceToBook: 3000 / 700,
      dividendRate: 0.52,
      dividendYield: 0.52 / 30,
      payoutRatio: 52 / 160.3384,
      fiftyTwoWeekHigh: 31,
      fiftyTwoWeekLow: 24,
      exDividendDate: null,
      nextEarningsDate: null,
    },
    statements,
    trailing: {
      revenue: null,
      operatingIncome: null,
      ebitda: null,
      netIncome: null,
      operatingCashFlow: null,
      capex: null,
      freeCashFlow: null,
    },
    analysts: {
      targetMean: 33,
      targetHigh: 40,
      targetLow: 26,
      count: 10,
      recommendationKey: "buy",
      recommendationMean: 2.1,
      revenueGrowthNextYear: 0.08,
      revenueGrowthCurrentYear: 0.08,
      epsGrowthNextYear: 0.1,
      epsGrowthCurrentYear: 0.09,
      ratings: { strongBuy: 3, buy: 4, hold: 3, sell: 0, strongSell: 0 },
    },
    earnings: [
      { period: "2025-03-31", estimate: 0.38, actual: 0.4, surprisePct: 0.0526 },
      { period: "2025-06-30", estimate: 0.39, actual: 0.41, surprisePct: 0.0513 },
      { period: "2025-09-30", estimate: 0.4, actual: 0.39, surprisePct: -0.025 },
      { period: "2025-12-31", estimate: 0.41, actual: 0.42, surprisePct: 0.0244 },
    ],
    insiders: {
      buyShares: 1000,
      sellShares: 500,
      netShares: 500,
      buyCount: 2,
      sellCount: 1,
      heldPct: 0.02,
      transactions: [],
    },
    peers: makePeers(),
    peerSource: "yahoo",
    macro: {
      riskFree: 0.043,
      riskFreeLabel: "Treasury dos EUA a 10 anos",
      us10y: 0.043,
      euro10y: 0.034,
      sp500PE: 23,
    },
    priceHistory,
    news: [],
    fetchedAt: "2026-01-15T10:00:00Z",
    warnings: [],
    ...over,
  };
}
