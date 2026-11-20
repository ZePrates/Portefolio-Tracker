/**
 * Qualidade da gestão: o que a gestão faz com o capital dos acionistas.
 *
 * - Criação de valor: ROIC acima do WACC, ano após ano.
 * - Alocação de capital: recompras vs. diluição, dividendos, remuneração em ações.
 * - Execução: resultados acima ou abaixo do que os analistas esperavam.
 * - Insiders: compras e vendas da própria gestão nos últimos 6 meses.
 */

import type { EvaYear } from "@/lib/valuation/economic-profit";
import { at, isNum, safeDiv } from "@/lib/valuation/stats";
import type { AnnualStatements, EarningsSurprise, InsiderActivity } from "@/lib/valuation/types";

export interface CapitalAllocation {
  /** Recompras dos últimos 12 meses em % da capitalização. */
  buybackYield: number | null;
  /** Dividendos pagos em % da capitalização. */
  dividendYield: number | null;
  /** Rendimento total para o acionista = dividendos + recompras líquidas de emissões. */
  shareholderYield: number | null;
  /** Remuneração em ações em % da receita. */
  sbcToRevenue: number | null;
  /** Dividendos + recompras em % do FCF. */
  payoutOfFcf: number | null;
  /** Variação anual média do número de ações. */
  shareChange: number | null;
}

export function capitalAllocation(
  s: AnnualStatements,
  marketCap: number,
  shareChange: number | null,
): CapitalAllocation {
  const buybacks = Math.abs(at(s.buybacks) ?? 0);
  const dividends = Math.abs(at(s.dividendsPaid) ?? 0);
  const fcf = at(s.freeCashFlow);
  const rev = at(s.revenue);
  return {
    buybackYield: marketCap > 0 ? buybacks / marketCap : null,
    dividendYield: marketCap > 0 ? dividends / marketCap : null,
    shareholderYield: marketCap > 0 ? (buybacks + dividends) / marketCap : null,
    sbcToRevenue: safeDiv(at(s.stockCompensation), rev),
    payoutOfFcf: isNum(fcf) && fcf > 0 ? (buybacks + dividends) / fcf : null,
    shareChange,
  };
}

export interface ExecutionRecord {
  quarters: number;
  beats: number;
  misses: number;
  averageSurprise: number | null;
}

export function executionRecord(earnings: readonly EarningsSurprise[]): ExecutionRecord {
  const known = earnings.filter((e) => isNum(e.actual) && isNum(e.estimate));
  const beats = known.filter((e) => e.actual! >= e.estimate!).length;
  const surprises = earnings.map((e) => e.surprisePct).filter(isNum);
  return {
    quarters: known.length,
    beats,
    misses: known.length - beats,
    averageSurprise: surprises.length
      ? surprises.reduce((a, b) => a + b, 0) / surprises.length
      : null,
  };
}

export type InsiderSignal = "compra" | "venda" | "neutro" | "sem_dados";

export function insiderSignal(ins: InsiderActivity): InsiderSignal {
  const buy = ins.buyShares ?? 0;
  const sell = ins.sellShares ?? 0;
  if (!isNum(ins.buyShares) && !isNum(ins.sellShares) && !ins.transactions.length)
    return "sem_dados";
  if (buy === 0 && sell === 0) return "neutro";
  if (buy > sell * 1.5) return "compra";
  if (sell > buy * 3 && (ins.sellCount ?? 0) >= 3) return "venda";
  return "neutro";
}

export interface ManagementScore {
  score: number | null;
  parts: { label: string; points: number; max: number; detail: string }[];
}

/**
 * Nota da gestão (0–100). Nos REITs o capital investido está ao custo dos
 * imóveis (ROIC estruturalmente baixo) e emitir ações faz parte do modelo de
 * negócio: conta antes se o FFO por ação cresce e se o dividendo está coberto.
 */
export function managementScore(
  eva: readonly EvaYear[],
  wacc: number,
  alloc: CapitalAllocation,
  exec: ExecutionRecord,
  insiders: InsiderSignal,
  reit?: { ffoGrowth: number | null; affoPayout: number | null },
): ManagementScore {
  const parts: ManagementScore["parts"] = [];
  const roics = eva.map((e) => e.roic).filter(isNum);
  if (reit) {
    if (isNum(reit.ffoGrowth)) {
      const g = reit.ffoGrowth;
      parts.push({
        label: "FFO por ação a crescer (as emissões criam valor)",
        points: g >= 0.04 ? 35 : g >= 0.01 ? 25 : g >= 0 ? 15 : 0,
        max: 35,
        detail: g >= 0.01 ? "Cresce" : g >= 0 ? "Estável" : "A descer",
      });
    }
    if (isNum(reit.affoPayout)) {
      const p = reit.affoPayout;
      parts.push({
        label: "Dividendo coberto pelo AFFO",
        points: p <= 0.8 ? 20 : p <= 0.9 ? 12 : p <= 1 ? 6 : 0,
        max: 20,
        detail: p <= 0.8 ? "Com folga" : p <= 1 ? "À justa" : "Paga mais do que gera",
      });
    }
  } else if (roics.length) {
    const above = roics.filter((r) => r > wacc).length;
    parts.push({
      label: "Cria valor (ROIC acima do WACC)",
      points: (above / roics.length) * 35,
      max: 35,
      detail: `${above} de ${roics.length} anos`,
    });
    if (roics.length >= 3) {
      const trendUp = roics[roics.length - 1]! >= roics[0]!;
      parts.push({
        label: "Tendência do ROIC",
        points: trendUp ? 10 : 3,
        max: 10,
        detail: trendUp ? "Estável ou a subir" : "A descer",
      });
    }
  }
  if (!reit && isNum(alloc.shareChange)) {
    const d = alloc.shareChange;
    parts.push({
      label: "Número de ações",
      points: d <= -0.01 ? 20 : d <= 0.005 ? 15 : d <= 0.02 ? 7 : 0,
      max: 20,
      detail: d <= -0.01 ? "Recompra ações" : d <= 0.005 ? "Estável" : "Dilui os acionistas",
    });
  }
  if (isNum(alloc.sbcToRevenue)) {
    const v = alloc.sbcToRevenue;
    parts.push({
      label: "Remuneração em ações",
      points: v <= 0.02 ? 10 : v <= 0.05 ? 6 : v <= 0.1 ? 2 : 0,
      max: 10,
      detail: v <= 0.02 ? "Contida" : v <= 0.05 ? "Moderada" : "Elevada",
    });
  }
  if (exec.quarters >= 2) {
    parts.push({
      label: "Cumpre o que o mercado espera",
      points: (exec.beats / exec.quarters) * 15,
      max: 15,
      detail: `${exec.beats} de ${exec.quarters} trimestres acima da estimativa`,
    });
  }
  if (insiders !== "sem_dados") {
    parts.push({
      label: "Insiders (últimos 6 meses)",
      points: insiders === "compra" ? 10 : insiders === "neutro" ? 6 : 2,
      max: 10,
      detail:
        insiders === "compra"
          ? "Compram mais do que vendem"
          : insiders === "venda"
            ? "Vendas relevantes"
            : "Sem sinal claro",
    });
  }
  const max = parts.reduce((a, p) => a + p.max, 0);
  const got = parts.reduce((a, p) => a + p.points, 0);
  return { score: max >= 30 ? (got / max) * 100 : null, parts };
}
