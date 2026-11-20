/**
 * Contexto de mercado: o S&P 500 está caro ou barato face às obrigações?
 *
 *   FED Model:  prémio = rendimento dos lucros do S&P 500 (1 / P/E) − Treasury a 10 anos
 *   Yardeni:    P/E justo = 1 / (CBY − d × LTEG)
 *               CBY = rendimento das obrigações de empresas Aaa,
 *               LTEG = crescimento dos lucros esperado a longo prazo, d = 0,1
 */

import { isNum } from "@/lib/valuation/stats";

export type MarketVerdict = "acoes_atrativas" | "neutro" | "acoes_caras";

export interface FedModelResult {
  earningsYield: number;
  bondYield: number;
  /** Rendimento dos lucros − rendimento das obrigações. */
  spread: number;
  verdict: MarketVerdict;
}

export function fedModel(sp500PE: number | null, us10y: number | null): FedModelResult | null {
  if (!isNum(sp500PE) || sp500PE <= 0 || !isNum(us10y)) return null;
  const earningsYield = 1 / sp500PE;
  const spread = earningsYield - us10y;
  return {
    earningsYield,
    bondYield: us10y,
    spread,
    verdict: spread > 0.01 ? "acoes_atrativas" : spread < -0.005 ? "acoes_caras" : "neutro",
  };
}

export interface YardeniResult {
  corporateBondYield: number;
  longTermGrowth: number;
  weight: number;
  fairPE: number;
  currentPE: number;
  /** P/E atual face ao justo − 1 (positivo = mercado acima do justo). */
  gap: number;
  verdict: MarketVerdict;
}

export function yardeni(
  sp500PE: number | null,
  corporateBondYield: number | null,
  longTermGrowth: number,
  weight = 0.1,
): YardeniResult | null {
  if (!isNum(sp500PE) || sp500PE <= 0 || !isNum(corporateBondYield)) return null;
  const ep = corporateBondYield - weight * longTermGrowth;
  if (ep <= 0.005) return null;
  const fairPE = 1 / ep;
  const gap = sp500PE / fairPE - 1;
  return {
    corporateBondYield,
    longTermGrowth,
    weight,
    fairPE,
    currentPE: sp500PE,
    gap,
    verdict: gap < -0.1 ? "acoes_atrativas" : gap > 0.1 ? "acoes_caras" : "neutro",
  };
}

export const VERDICT_LABELS: Record<MarketVerdict, string> = {
  acoes_atrativas: "Ações atrativas face às obrigações",
  neutro: "Sem desvio relevante",
  acoes_caras: "Ações caras face às obrigações",
};
