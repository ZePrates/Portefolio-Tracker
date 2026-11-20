/**
 * Avaliação por múltiplos de empresas comparáveis.
 *
 * Calculam-se seis múltiplos com a mediana dos pares (sem valores negativos
 * nem extremos). Se houver menos de 3 pares válidos, usa-se o múltiplo da
 * indústria do Damodaran. Nunca se mistura o múltiplo da própria empresa: seria
 * circular (P/E próprio × EPS = preço atual). Só os múltiplos indicados para o
 * tipo de empresa entram no valor justo, com o mesmo peso.
 */

import type { ProfileType } from "@/lib/valuation/classify";
import type { IndustryRef } from "@/lib/valuation/damodaran";
import { isNum, median, quantile } from "@/lib/valuation/stats";
import type { PeerMultiples } from "@/lib/valuation/types";

export type MultipleKey = "pe" | "forwardPe" | "evEbitda" | "evEbit" | "evSales" | "pb";

export const MULTIPLE_LABELS: Record<MultipleKey, string> = {
  pe: "P/E (últimos 12 meses)",
  forwardPe: "P/E (próximos 12 meses)",
  evEbitda: "EV/EBITDA",
  evEbit: "EV/EBIT",
  evSales: "EV/Vendas",
  pb: "P/VC (preço / valor contabilístico)",
};

/** Limites acima dos quais um múltiplo é tratado como extremo e excluído. */
const MAX_MULTIPLE: Record<MultipleKey, number> = {
  pe: 80,
  forwardPe: 80,
  evEbitda: 50,
  evEbit: 60,
  evSales: 30,
  pb: 30,
};

/** Múltiplos que contam para o valor justo de cada tipo de empresa. */
export const MULTIPLES_BY_PROFILE: Record<ProfileType, MultipleKey[]> = {
  madura: ["pe", "forwardPe", "evEbitda", "evEbit"],
  crescimento: ["forwardPe", "evEbitda", "evSales"],
  ciclica: ["evEbitda", "evSales", "pb"],
  financeira: ["pe", "forwardPe", "pb"],
  // Nos REITs o valor contabilístico (imóveis ao custo, menos imparidades) não
  // compara REITs entre si: o P/VC fica só como referência.
  reit: ["evEbitda"],
};

export interface MultipleInputs {
  price: number;
  shares: number;
  /** Lucro por ação dos últimos 12 meses (preço ÷ P/E do mercado). */
  eps: number | null;
  /** Lucro por ação esperado (preço ÷ P/E futuro). */
  forwardEps: number | null;
  ebitda: number | null;
  ebit: number | null;
  revenue: number | null;
  bookValue: number | null;
  cash: number;
  debt: number;
  minorityInterest: number;
}

export interface MultipleRow {
  key: MultipleKey;
  label: string;
  /** Múltiplo atual da própria empresa (só para comparação). */
  own: number | null;
  /** Múltiplo de referência usado (mediana dos pares ou da indústria). */
  reference: number | null;
  /** 1.º quartil dos pares (leitura conservadora). */
  peerQ1: number | null;
  peerCount: number;
  source: "pares" | "industria" | null;
  impliedPrice: number | null;
  /** Conta para o valor justo deste tipo de empresa. */
  counts: boolean;
  /** Motivo para não haver valor. */
  note: string | null;
}

export interface MultiplesResult {
  rows: MultipleRow[];
  /** Média simples dos múltiplos que contam; null se nenhum tiver valor. */
  value: number | null;
  usedPeers: string[];
}

export function cleanPeerValues(values: readonly (number | null)[], key: MultipleKey): number[] {
  return values.filter((v): v is number => isNum(v) && v > 0 && v <= MAX_MULTIPLE[key]);
}

function industryMultiple(ref: IndustryRef, key: MultipleKey): number | null {
  const v =
    key === "pe"
      ? ref.pe
      : key === "forwardPe"
        ? ref.forwardPe
        : key === "evEbitda"
          ? ref.evEbitda
          : key === "evEbit"
            ? ref.evEbit
            : key === "evSales"
              ? ref.evSales
              : ref.pb;
  return isNum(v) && v > 0 && v <= MAX_MULTIPLE[key] ? v : null;
}

export function multiplesValuation(
  inp: MultipleInputs,
  peers: readonly PeerMultiples[],
  industry: IndustryRef,
  profile: ProfileType,
): MultiplesResult {
  const counted = new Set(MULTIPLES_BY_PROFILE[profile]);
  const ev = inp.price * inp.shares + inp.debt - inp.cash + inp.minorityInterest;
  const bridge = (enterprise: number) =>
    (enterprise - inp.debt + inp.cash - inp.minorityInterest) / inp.shares;
  const keys: MultipleKey[] = ["pe", "forwardPe", "evEbitda", "evEbit", "evSales", "pb"];

  const rows = keys.map((key): MultipleRow => {
    const peerVals = cleanPeerValues(
      peers.map((p) => p[key]),
      key,
    );
    const fromPeers = peerVals.length >= 3;
    const reference = fromPeers ? median(peerVals) : industryMultiple(industry, key);
    const source: MultipleRow["source"] =
      reference == null ? null : fromPeers ? "pares" : "industria";
    const metric =
      key === "pe"
        ? inp.eps
        : key === "forwardPe"
          ? inp.forwardEps
          : key === "evEbitda"
            ? inp.ebitda
            : key === "evEbit"
              ? inp.ebit
              : key === "evSales"
                ? inp.revenue
                : inp.bookValue;
    const perShareMetric = key === "pe" || key === "forwardPe";
    let own: number | null = null;
    let impliedPrice: number | null = null;
    let note: string | null = null;
    if (!isNum(metric) || metric <= 0) {
      note =
        key === "pb"
          ? "Capital próprio negativo: o múltiplo não se aplica."
          : "Indicador negativo ou em falta: o múltiplo não se aplica.";
    } else if (reference == null) {
      note = "Sem pares nem referência da indústria para este múltiplo.";
    } else if (perShareMetric) {
      own = inp.price / metric;
      impliedPrice = reference * metric;
    } else if (key === "pb") {
      own = (inp.price * inp.shares) / metric;
      impliedPrice = (reference * metric) / inp.shares;
    } else {
      own = ev / metric;
      impliedPrice = bridge(reference * metric);
    }
    if (isNum(impliedPrice) && impliedPrice <= 0) {
      note = "A dívida líquida supera o valor implícito: sem valor para o acionista.";
      impliedPrice = null;
    }
    return {
      key,
      label: MULTIPLE_LABELS[key],
      own,
      reference,
      peerQ1: fromPeers ? quantile(peerVals, 0.25) : null,
      peerCount: peerVals.length,
      source,
      impliedPrice,
      counts: counted.has(key),
      note,
    };
  });

  const usedValues = rows
    .filter((r) => r.counts && isNum(r.impliedPrice))
    .map((r) => r.impliedPrice!);
  return {
    rows,
    value: usedValues.length ? usedValues.reduce((s, v) => s + v, 0) / usedValues.length : null,
    usedPeers: peers.map((p) => p.symbol),
  };
}
