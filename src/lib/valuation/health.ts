/**
 * Saúde financeira e qualidade da informação:
 * - Altman Z-Score (original, para indústria) e Z'' (serviços e mercados emergentes);
 * - Piotroski F-Score (9 critérios) nos dois últimos anos;
 * - Beneish M-Score (8 variáveis) para sinais de manipulação de resultados;
 * - rácios de rentabilidade, liquidez, solvência, conversão em caixa e DuPont;
 * - equilíbrio financeiro (fundo de maneio, necessidades e tesouraria líquida).
 */

import { formatNumber, formatPct, formatPercent } from "@/lib/format";
import { at, cagr, isNum, safeDiv, span } from "@/lib/valuation/stats";
import type { AnnualStatements } from "@/lib/valuation/types";

/* ------------------------------------------------------------------ */
/* Altman                                                               */
/* ------------------------------------------------------------------ */

export type AltmanZone = "segura" | "cinzenta" | "perigo";

export interface AltmanResult {
  model: "original" | "z2";
  x1: number;
  x2: number;
  x3: number;
  /** Original: valor de mercado do capital / passivo; Z'': capital próprio contabilístico / passivo. */
  x4: number;
  /** Só no modelo original: vendas / ativo. */
  x5: number | null;
  score: number;
  zone: AltmanZone;
  /** Os dois modelos, para comparação. */
  original: number | null;
  z2: number | null;
}

const MANUFACTURING =
  /manufactur|auto|semiconductor|hardware|chemical|steel|aluminum|machinery|aerospace|defense|packaging|food|beverage|tobacco|apparel|footwear|building products|building materials|electrical equipment|electronic components|drug manufacturers|paper|lumber|metal fabrication|tools|farm|furnishings|household|oil|gas|mining|copper|gold|silver|coal/;

export function isManufacturing(sector: string | null, industry: string | null): boolean {
  const sec = (sector ?? "").toLowerCase();
  if (sec === "industrials" || sec === "basic materials" || sec === "energy") return true;
  return MANUFACTURING.test((industry ?? "").toLowerCase());
}

export function altman(
  s: AnnualStatements,
  marketCap: number,
  manufacturing: boolean,
): AltmanResult | null {
  const ta = at(s.totalAssets);
  const tl = at(s.totalLiabilities);
  const ca = at(s.currentAssets);
  const cl = at(s.currentLiabilities);
  const re = at(s.retainedEarnings);
  const ebit = at(s.operatingIncome);
  const sales = at(s.revenue);
  const eq = at(s.equity);
  if (!isNum(ta) || ta <= 0 || !isNum(tl) || tl <= 0 || !isNum(ca) || !isNum(cl) || !isNum(ebit)) {
    return null;
  }
  const x1 = (ca - cl) / ta;
  const x2 = (re ?? 0) / ta;
  const x3 = ebit / ta;
  const x4m = marketCap / tl;
  const x5 = isNum(sales) ? sales / ta : null;
  const original = x5 != null ? 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4m + 1.0 * x5 : null;
  const x4b = isNum(eq) ? eq / tl : null;
  const z2 = x4b != null ? 6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4b : null;
  const useOriginal = manufacturing ? original != null : z2 == null;
  if (useOriginal && original != null) {
    return {
      model: "original",
      x1,
      x2,
      x3,
      x4: x4m,
      x5,
      score: original,
      zone: original > 2.99 ? "segura" : original >= 1.81 ? "cinzenta" : "perigo",
      original,
      z2,
    };
  }
  if (z2 == null || x4b == null) return null;
  return {
    model: "z2",
    x1,
    x2,
    x3,
    x4: x4b,
    x5: null,
    score: z2,
    zone: z2 > 2.6 ? "segura" : z2 >= 1.1 ? "cinzenta" : "perigo",
    original,
    z2,
  };
}

/* ------------------------------------------------------------------ */
/* Piotroski                                                            */
/* ------------------------------------------------------------------ */

export interface PiotroskiCriterion {
  id: string;
  group: "Rentabilidade" | "Estrutura e liquidez" | "Eficiência";
  label: string;
  /** true = 1 ponto; null = sem dados. */
  pass: boolean | null;
  detail: string;
}

export interface PiotroskiResult {
  period: string;
  score: number;
  /** Critérios com dados (o máximo possível). */
  available: number;
  criteria: PiotroskiCriterion[];
}

const pctTxt = (v: number | null) => (isNum(v) ? formatPct(v * 100) : "—");
const numTxt = (v: number | null) => (isNum(v) ? formatNumber(v, 2) : "—");

function cmp(a: number | null, b: number | null, better: "up" | "down"): boolean | null {
  if (!isNum(a) || !isNum(b)) return null;
  return better === "up" ? a > b : a < b;
}

/** F-Score do ano `i` (índice nas séries), comparado com o ano anterior. */
export function piotroskiAt(s: AnnualStatements, i: number): PiotroskiResult | null {
  if (i < 1 || i >= s.periods.length) return null;
  const v = (k: keyof AnnualStatements, j: number) => {
    const series = s[k] as readonly (number | null)[];
    const x = series[j];
    return isNum(x) ? x : null;
  };
  const begAssets = (j: number) => v("totalAssets", j - 1) ?? v("totalAssets", j);
  const roa = (j: number) => safeDiv(v("netIncome", j), begAssets(j));
  const cfoRoa = (j: number) => safeDiv(v("operatingCashFlow", j), begAssets(j));
  const avgAssets = (j: number) => {
    const a = v("totalAssets", j);
    const b = v("totalAssets", j - 1);
    return isNum(a) && isNum(b) ? (a + b) / 2 : a;
  };
  const debtOf = (j: number) => v("longTermDebt", j) ?? v("totalDebt", j);
  const lever = (j: number) => safeDiv(debtOf(j), avgAssets(j));
  const cr = (j: number) => safeDiv(v("currentAssets", j), v("currentLiabilities", j));
  const shares = (j: number) => v("sharesOutstanding", j) ?? v("dilutedShares", j);
  const gm = (j: number) => {
    const rev = v("revenue", j);
    const gp =
      v("grossProfit", j) ??
      (isNum(rev) && isNum(v("costOfRevenue", j)) ? rev - v("costOfRevenue", j)! : null);
    return safeDiv(gp, rev);
  };
  const ato = (j: number) => safeDiv(v("revenue", j), begAssets(j));

  const roaNow = roa(i);
  const roaPrev = i >= 1 ? roa(i - 1) : null;
  const cfo = v("operatingCashFlow", i);
  const levNow = lever(i);
  const levPrev = lever(i - 1);
  const shNow = shares(i);
  const shPrev = shares(i - 1);
  const criteria: PiotroskiCriterion[] = [
    {
      id: "roa",
      group: "Rentabilidade",
      label: "Resultado líquido positivo (ROA > 0)",
      pass: isNum(roaNow) ? roaNow > 0 : null,
      detail: `ROA ${pctTxt(roaNow)}`,
    },
    {
      id: "cfo",
      group: "Rentabilidade",
      label: "Fluxo de caixa operacional positivo",
      pass: isNum(cfo) ? cfo > 0 : null,
      detail: isNum(cfo)
        ? cfo > 0
          ? "Gerou caixa com a operação"
          : "Consumiu caixa na operação"
        : "—",
    },
    {
      id: "droa",
      group: "Rentabilidade",
      label: "ROA a subir face ao ano anterior",
      pass: cmp(roaNow, roaPrev, "up"),
      detail: `${pctTxt(roaPrev)} → ${pctTxt(roaNow)}`,
    },
    {
      id: "accrual",
      group: "Rentabilidade",
      label: "Caixa operacional acima do lucro (qualidade dos resultados)",
      pass: cmp(cfoRoa(i), roaNow, "up"),
      detail: `CFO/ativo ${pctTxt(cfoRoa(i))} vs ROA ${pctTxt(roaNow)}`,
    },
    {
      id: "lever",
      group: "Estrutura e liquidez",
      label: "Endividamento de longo prazo a descer",
      pass:
        isNum(levNow) && isNum(levPrev)
          ? levNow < levPrev || (levNow === 0 && levPrev === 0)
          : null,
      detail: `Dívida/ativo ${pctTxt(levPrev)} → ${pctTxt(levNow)}`,
    },
    {
      id: "liquidity",
      group: "Estrutura e liquidez",
      label: "Liquidez geral a melhorar",
      pass: cmp(cr(i), cr(i - 1), "up"),
      detail: `${numTxt(cr(i - 1))} → ${numTxt(cr(i))}`,
    },
    {
      id: "shares",
      group: "Estrutura e liquidez",
      label: "Sem emissão de novas ações",
      pass: isNum(shNow) && isNum(shPrev) ? shNow <= shPrev * 1.005 : null,
      detail:
        isNum(shNow) && isNum(shPrev) && shPrev > 0
          ? `Ações ${formatPercent(((shNow - shPrev) / shPrev) * 100)}`
          : "—",
    },
    {
      id: "margin",
      group: "Eficiência",
      label: "Margem bruta a subir",
      pass: cmp(gm(i), gm(i - 1), "up"),
      detail: `${pctTxt(gm(i - 1))} → ${pctTxt(gm(i))}`,
    },
    {
      id: "turnover",
      group: "Eficiência",
      label: "Rotação do ativo a subir",
      pass: cmp(ato(i), ato(i - 1), "up"),
      detail: `${numTxt(ato(i - 1))} → ${numTxt(ato(i))}`,
    },
  ];
  const known = criteria.filter((c) => c.pass !== null);
  return {
    period: s.periods[i]!,
    score: known.filter((c) => c.pass).length,
    available: known.length,
    criteria,
  };
}

/** F-Score dos anos disponíveis (do mais antigo ao mais recente). */
export function piotroskiHistory(s: AnnualStatements): PiotroskiResult[] {
  const out: PiotroskiResult[] = [];
  for (let i = 1; i < s.periods.length; i++) {
    const r = piotroskiAt(s, i);
    if (r && r.available >= 6) out.push(r);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Beneish                                                              */
/* ------------------------------------------------------------------ */

export interface BeneishResult {
  score: number;
  /** Acima de −1,78 há sinais compatíveis com manipulação. */
  flagged: boolean;
  indices: Record<
    "dsri" | "gmi" | "aqi" | "sgi" | "depi" | "sgai" | "lvgi" | "tata",
    number | null
  >;
  /** Índices sem dados (assumidos neutros = 1; TATA = 0). */
  missing: string[];
}

export function beneish(s: AnnualStatements): BeneishResult | null {
  const n = s.periods.length;
  if (n < 2) return null;
  const i = n - 1;
  const g = (k: keyof AnnualStatements, j: number) => {
    const x = (s[k] as readonly (number | null)[])[j];
    return isNum(x) ? x : null;
  };
  const ratio = (a: number | null, b: number | null) =>
    isNum(a) && isNum(b) && b !== 0 ? a / b : null;
  const sales = (j: number) => g("revenue", j);
  const gm = (j: number) => {
    const gp =
      g("grossProfit", j) ??
      (isNum(sales(j)) && isNum(g("costOfRevenue", j)) ? sales(j)! - g("costOfRevenue", j)! : null);
    return ratio(gp, sales(j));
  };
  const aq = (j: number) => {
    const ta = g("totalAssets", j);
    const ca = g("currentAssets", j);
    const ppe = g("netPPE", j);
    return isNum(ta) && isNum(ca) && isNum(ppe) && ta > 0 ? 1 - (ca + ppe) / ta : null;
  };
  const dep = (j: number) => {
    const d = g("depreciation", j);
    const ppe = g("netPPE", j);
    return isNum(d) && isNum(ppe) && d + ppe > 0 ? Math.abs(d) / (Math.abs(d) + ppe) : null;
  };
  const lev = (j: number) => {
    const ta = g("totalAssets", j);
    const cl = g("currentLiabilities", j);
    const ltd = g("longTermDebt", j) ?? 0;
    return isNum(ta) && isNum(cl) && ta > 0 ? (cl + ltd) / ta : null;
  };
  const indices: BeneishResult["indices"] = {
    dsri: ratio(ratio(g("receivables", i), sales(i)), ratio(g("receivables", i - 1), sales(i - 1))),
    gmi: ratio(gm(i - 1), gm(i)),
    aqi: ratio(aq(i), aq(i - 1)),
    sgi: ratio(sales(i), sales(i - 1)),
    depi: ratio(dep(i - 1), dep(i)),
    sgai: ratio(ratio(g("sga", i), sales(i)), ratio(g("sga", i - 1), sales(i - 1))),
    lvgi: ratio(lev(i), lev(i - 1)),
    tata: (() => {
      const ni = g("netIncome", i);
      const cfo = g("operatingCashFlow", i);
      const ta = g("totalAssets", i);
      return isNum(ni) && isNum(cfo) && isNum(ta) && ta > 0 ? (ni - cfo) / ta : null;
    })(),
  };
  const missing = Object.entries(indices)
    .filter(([, v]) => !isNum(v))
    .map(([k]) => k.toUpperCase());
  if (missing.length > 3 || !isNum(indices.sgi)) return null;
  const val = (k: keyof BeneishResult["indices"], neutral: number) => indices[k] ?? neutral;
  const score =
    -4.84 +
    0.92 * val("dsri", 1) +
    0.528 * val("gmi", 1) +
    0.404 * val("aqi", 1) +
    0.892 * val("sgi", 1) +
    0.115 * val("depi", 1) -
    0.172 * val("sgai", 1) +
    4.679 * val("tata", 0) -
    0.327 * val("lvgi", 1);
  return { score, flagged: score > -1.78, indices, missing };
}

/* ------------------------------------------------------------------ */
/* Rácios                                                               */
/* ------------------------------------------------------------------ */

export interface QualityMetrics {
  grossMargin: number | null;
  operatingMargin: number | null;
  ebitdaMargin: number | null;
  netMargin: number | null;
  fcfMargin: number | null;
  roe: number | null;
  roa: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  cashRatio: number | null;
  debtToEquity: number | null;
  netDebt: number | null;
  netDebtToEbitda: number | null;
  interestCoverage: number | null;
  /** Autonomia financeira: capital próprio / ativo. */
  equityToAssets: number | null;
  /** Solvabilidade: capital próprio / passivo. */
  equityToLiabilities: number | null;
  /** CFO / resultado líquido. */
  cashConversion: number | null;
  /** FCF / resultado líquido. */
  fcfConversion: number | null;
  cfoToEbitda: number | null;
  /** (Resultado líquido − CFO) / ativo médio (Sloan). */
  accrualsRatio: number | null;
  capexToDepreciation: number | null;
  sbcToRevenue: number | null;
  revenueCagr: number | null;
  epsCagr: number | null;
  fcfCagr: number | null;
  /** Variação anual média do número de ações (positivo = diluição). */
  shareChange: number | null;
  daysSales: number | null;
  daysInventory: number | null;
  daysPayables: number | null;
  cashCycle: number | null;
  years: number;
}

export function qualityMetrics(s: AnnualStatements): QualityMetrics {
  const rev = at(s.revenue);
  const ni = at(s.netIncome);
  const ebit = at(s.operatingIncome);
  const dep = at(s.depreciation);
  const ebitda = at(s.ebitda) ?? (isNum(ebit) && isNum(dep) ? ebit + Math.abs(dep) : null);
  const gp =
    at(s.grossProfit) ??
    (isNum(rev) && isNum(at(s.costOfRevenue)) ? rev - at(s.costOfRevenue)! : null);
  const cfo = at(s.operatingCashFlow);
  const capex = at(s.capex);
  const fcf = at(s.freeCashFlow) ?? (isNum(cfo) && isNum(capex) ? cfo - Math.abs(capex) : null);
  const ta = at(s.totalAssets);
  const taPrev = at(s.totalAssets, 1);
  const avgTa = isNum(ta) && isNum(taPrev) ? (ta + taPrev) / 2 : ta;
  const eq = at(s.equity);
  const eqPrev = at(s.equity, 1);
  const avgEq = isNum(eq) && isNum(eqPrev) ? (eq + eqPrev) / 2 : eq;
  const ca = at(s.currentAssets);
  const cl = at(s.currentLiabilities);
  const inv = at(s.inventory);
  const cash = at(s.cash);
  const debt = at(s.totalDebt);
  const tl = at(s.totalLiabilities);
  const interest = at(s.interestExpense);
  const cogs = at(s.costOfRevenue) ?? (isNum(rev) && isNum(gp) ? rev - gp : null);
  const netDebt = isNum(debt) ? debt - (cash ?? 0) : null;
  const shares = isNum(at(s.sharesOutstanding)) ? s.sharesOutstanding : s.dilutedShares;
  const shareSpan = span(shares);
  const epsSeries = s.netIncome.map((x, k) =>
    safeDiv(x, s.dilutedShares[k] ?? s.sharesOutstanding[k]),
  );
  const epsSpan = span(epsSeries);
  const fcfSeries = s.freeCashFlow;
  const fcfSpan = span(fcfSeries);
  const revSpan = span(s.revenue);
  const dso = safeDiv(at(s.receivables), rev);
  const dio = safeDiv(inv, cogs);
  const dpo = safeDiv(at(s.payables), cogs);
  return {
    grossMargin: safeDiv(gp, rev),
    operatingMargin: safeDiv(ebit, rev),
    ebitdaMargin: safeDiv(ebitda, rev),
    netMargin: safeDiv(ni, rev),
    fcfMargin: safeDiv(fcf, rev),
    roe: isNum(avgEq) && avgEq > 0 ? safeDiv(ni, avgEq) : null,
    roa: safeDiv(ni, avgTa),
    currentRatio: safeDiv(ca, cl),
    quickRatio: isNum(ca) && isNum(cl) && cl > 0 ? (ca - (inv ?? 0)) / cl : null,
    cashRatio: safeDiv(cash, cl),
    debtToEquity: isNum(eq) && eq > 0 ? safeDiv(debt, eq) : null,
    netDebt,
    netDebtToEbitda: isNum(ebitda) && ebitda > 0 ? safeDiv(netDebt, ebitda) : null,
    interestCoverage:
      isNum(interest) && Math.abs(interest) > 0 ? safeDiv(ebit, Math.abs(interest)) : null,
    equityToAssets: safeDiv(eq, ta),
    equityToLiabilities: safeDiv(eq, tl),
    cashConversion: isNum(ni) && ni > 0 ? safeDiv(cfo, ni) : null,
    fcfConversion: isNum(ni) && ni > 0 ? safeDiv(fcf, ni) : null,
    cfoToEbitda: isNum(ebitda) && ebitda > 0 ? safeDiv(cfo, ebitda) : null,
    accrualsRatio: isNum(ni) && isNum(cfo) ? safeDiv(ni - cfo, avgTa) : null,
    capexToDepreciation:
      isNum(capex) && isNum(dep) && dep !== 0 ? Math.abs(capex) / Math.abs(dep) : null,
    sbcToRevenue: safeDiv(at(s.stockCompensation), rev),
    revenueCagr: revSpan ? cagr(revSpan.first, revSpan.last, revSpan.years) : null,
    epsCagr: epsSpan ? cagr(epsSpan.first, epsSpan.last, epsSpan.years) : null,
    fcfCagr: fcfSpan ? cagr(fcfSpan.first, fcfSpan.last, fcfSpan.years) : null,
    shareChange: shareSpan ? cagr(shareSpan.first, shareSpan.last, shareSpan.years) : null,
    daysSales: isNum(dso) ? dso * 365 : null,
    daysInventory: isNum(dio) ? dio * 365 : null,
    daysPayables: isNum(dpo) ? dpo * 365 : null,
    cashCycle: isNum(dso) && isNum(dpo) ? (dso + (isNum(dio) ? dio : 0) - dpo) * 365 : null,
    years: s.periods.length,
  };
}

/* ------------------------------------------------------------------ */
/* DuPont                                                               */
/* ------------------------------------------------------------------ */

export interface DupontResult {
  taxBurden: number | null;
  interestBurden: number | null;
  ebitMargin: number | null;
  netMargin: number | null;
  assetTurnover: number | null;
  leverage: number | null;
  roe: number | null;
}

export function dupont(s: AnnualStatements): DupontResult {
  const ni = at(s.netIncome);
  const ebt = at(s.pretaxIncome);
  const ebit = at(s.operatingIncome);
  const rev = at(s.revenue);
  const ta = at(s.totalAssets);
  const eq = at(s.equity);
  const netMargin = safeDiv(ni, rev);
  const assetTurnover = safeDiv(rev, ta);
  const leverage = isNum(eq) && eq > 0 ? safeDiv(ta, eq) : null;
  return {
    taxBurden: safeDiv(ni, ebt),
    interestBurden: safeDiv(ebt, ebit),
    ebitMargin: safeDiv(ebit, rev),
    netMargin,
    assetTurnover,
    leverage,
    roe:
      isNum(netMargin) && isNum(assetTurnover) && isNum(leverage)
        ? netMargin * assetTurnover * leverage
        : null,
  };
}

/* ------------------------------------------------------------------ */
/* Equilíbrio financeiro                                                */
/* ------------------------------------------------------------------ */

export type BalanceState =
  | "equilibrio_margem"
  | "equilibrio"
  | "grande_distribuicao"
  | "dependencia_bancaria"
  | "desequilibrio";

export const BALANCE_LABELS: Record<BalanceState, string> = {
  equilibrio_margem: "Equilíbrio com margem de segurança",
  equilibrio: "Equilíbrio financeiro",
  grande_distribuicao: "Típico da grande distribuição",
  dependencia_bancaria: "Dependência do sistema bancário",
  desequilibrio: "Desequilíbrio financeiro",
};

export const BALANCE_EXPLANATIONS: Record<BalanceState, string> = {
  equilibrio_margem:
    "Os capitais permanentes financiam todo o ativo fixo e ainda sobra fundo de maneio bem acima das necessidades do ciclo: há folga de tesouraria.",
  equilibrio:
    "O fundo de maneio cobre as necessidades do ciclo de exploração, mas com pouca folga.",
  grande_distribuicao:
    "O fundo de maneio é negativo, mas os fornecedores financiam o ciclo (recebe dos clientes antes de pagar): comum no retalho alimentar.",
  dependencia_bancaria:
    "O fundo de maneio não chega para as necessidades do ciclo: a diferença é financiada com crédito bancário de curto prazo.",
  desequilibrio:
    "Parte do ativo fixo é financiada com dívida de curto prazo e a tesouraria líquida é negativa: risco de falta de liquidez.",
};

export interface BalanceAnalysis {
  /** Fundo de maneio = ativo corrente − passivo corrente. */
  workingCapital: number;
  /** Necessidades de fundo de maneio = FM − TL (tudo o que é cíclico). */
  workingCapitalNeeds: number;
  /** Tesouraria líquida = caixa − dívida de curto prazo. */
  netTreasury: number;
  /** "direto" = caixa − dívida de curto prazo; "aproximado" = clientes + inventários − fornecedores. */
  method: "direto" | "aproximado";
  state: BalanceState;
}

/**
 * FM = NFM + TL. A tesouraria líquida calcula-se pelo método direto (caixa −
 * dívida de curto prazo), para que receitas diferidas e adiantamentos de
 * clientes contem como recursos do ciclo e não como dívida bancária. Sem a
 * dívida de curto prazo, aproxima-se a NFM por clientes + inventários − fornecedores.
 */
export function financialBalance(s: AnnualStatements): BalanceAnalysis | null {
  const ca = at(s.currentAssets);
  const cl = at(s.currentLiabilities);
  if (!isNum(ca) || !isNum(cl)) return null;
  const fm = ca - cl;
  const cash = at(s.cash);
  const currentDebt = at(s.currentDebt);
  let tl: number;
  let nfm: number;
  let method: BalanceAnalysis["method"];
  if (isNum(cash) && isNum(currentDebt)) {
    tl = cash - currentDebt;
    nfm = fm - tl;
    method = "direto";
  } else {
    const rec = at(s.receivables);
    const inv = at(s.inventory);
    const pay = at(s.payables);
    if (!isNum(rec) && !isNum(inv) && !isNum(pay)) return null;
    nfm = (rec ?? 0) + (inv ?? 0) - (pay ?? 0);
    tl = fm - nfm;
    method = "aproximado";
  }
  let state: BalanceState;
  if (tl < 0) state = fm > 0 ? "dependencia_bancaria" : "desequilibrio";
  else if (fm < 0) state = "grande_distribuicao";
  else state = nfm <= 0 || fm >= 1.2 * nfm ? "equilibrio_margem" : "equilibrio";
  return { workingCapital: fm, workingCapitalNeeds: nfm, netTreasury: tl, method, state };
}

/* ------------------------------------------------------------------ */
/* Nota de saúde                                                        */
/* ------------------------------------------------------------------ */

export interface HealthScore {
  score: number | null;
  parts: { label: string; points: number; max: number }[];
}

export function healthScore(
  alt: AltmanResult | null,
  pio: PiotroskiResult | null,
  q: QualityMetrics,
  ben: BeneishResult | null,
): HealthScore {
  const parts: HealthScore["parts"] = [];
  if (alt) {
    parts.push({
      label: "Risco de falência (Altman)",
      points: alt.zone === "segura" ? 30 : alt.zone === "cinzenta" ? 15 : 0,
      max: 30,
    });
  }
  if (pio && pio.available > 0) {
    parts.push({
      label: "Evolução da saúde (Piotroski)",
      points: (pio.score / pio.available) * 25,
      max: 25,
    });
  }
  const nde = q.netDebtToEbitda;
  if (isNum(q.netDebt) && q.netDebt <= 0) {
    parts.push({ label: "Dívida (tem mais caixa do que dívida)", points: 15, max: 15 });
  } else if (isNum(nde)) {
    parts.push({
      label: "Dívida líquida / EBITDA",
      points: nde <= 1 ? 15 : nde <= 2.5 ? 10 : nde <= 4 ? 5 : 0,
      max: 15,
    });
  }
  if (isNum(q.interestCoverage)) {
    const c = q.interestCoverage;
    parts.push({
      label: "Cobertura dos juros",
      points: c >= 8 ? 10 : c >= 4 ? 7 : c >= 2 ? 3 : 0,
      max: 10,
    });
  }
  if (isNum(q.currentRatio)) {
    const r = q.currentRatio;
    parts.push({ label: "Liquidez geral", points: r >= 1.5 ? 10 : r >= 1 ? 6 : 2, max: 10 });
  }
  if (ben || isNum(q.accrualsRatio)) {
    let pts = 10;
    if (ben?.flagged) pts -= 6;
    if (isNum(q.accrualsRatio) && q.accrualsRatio > 0.05) pts -= 4;
    parts.push({ label: "Qualidade dos resultados", points: Math.max(0, pts), max: 10 });
  }
  const max = parts.reduce((a, p) => a + p.max, 0);
  const got = parts.reduce((a, p) => a + p.points, 0);
  return { score: max >= 30 ? (got / max) * 100 : null, parts };
}
