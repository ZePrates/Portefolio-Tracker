import {
  assetCurrentValue,
  CLASS_LABELS,
  CLASS_ORDER,
  isOpenPosition,
  type Asset,
  type AssetClass,
} from "@/lib/portfolio-types";
import { formatPct, formatPp } from "@/lib/format";
import type { PositionInput } from "@/lib/exposure-types";
import type { AllocationTargetInput } from "@/lib/allocation";
import { computeLookThrough } from "@/lib/intelligence";

/**
 * Simulador de compra. Usa o mesmo critério da Inteligência: a concentração
 * mede-se por EMPRESA, contando o peso de cada uma dentro dos ETFs
 * (look-through). Ter muito em ETFs não é, por si, risco. O peso de cada
 * classe só se compara com os alvos de alocação que tiveres definido.
 */

/** Limites iguais aos da Inteligência (`portfolioIntelligence`). */
export const LARGEST_COMPANY_LIMIT = 10;
export const TOP5_COMPANIES_LIMIT = 30;
/** Abaixo disto (pp) uma variação não conta como agravamento. */
const EPSILON = 0.05;

export interface PurchaseProposal {
  amount: number;
  assetClass: AssetClass;
  assetId?: string;
  name: string;
}

export interface PurchaseContext {
  /** Posições com composição (de `getExposure`). Sem elas, cada posição conta como uma empresa. */
  positions?: PositionInput[];
  /** Alvos de alocação por classe (só os definidos). */
  targets?: AllocationTargetInput[];
}

export interface AllocationDelta {
  class: AssetClass;
  label: string;
  currentPct: number;
  proposedPct: number;
  deltaPct: number;
  currentValue: number;
  proposedValue: number;
  /** Alvo da classe em %, ou null quando não há alvos definidos. */
  targetPct: number | null;
}

export interface ConcentrationSnapshot {
  /** Maior exposição a uma empresa, em % da carteira (com o que está dentro dos ETFs). */
  largestCompanyPct: number;
  largestCompanyLabel: string | null;
  /** Soma das 5 maiores exposições a empresas, em %. */
  top5CompaniesPct: number;
}

export interface PurchaseAnalysis {
  currentTotal: number;
  proposedTotal: number;
  purchasePct: number;
  allocation: AllocationDelta[];
  before: ConcentrationSnapshot;
  after: ConcentrationSnapshot;
  /** A composição dos ETFs foi usada (há posições com holdings). */
  lookThrough: boolean;
  /** Há alvos de alocação por classe definidos. */
  hasTargets: boolean;
  /** Avisos (a compra agrava concentração ou afasta do alvo). */
  alerts: string[];
  /** Notas positivas (a compra aproxima a classe do alvo). */
  notes: string[];
}

/** Posições sem composição conhecida: cada uma conta como uma "empresa". */
function directPositions(open: Asset[]): PositionInput[] {
  return open.map((a) => ({
    assetId: a.id,
    name: a.name,
    class: a.class,
    ticker: a.ticker,
    value: assetCurrentValue(a),
    nativeCurrency: a.native_currency,
    exposures: [],
    holdings: [],
  }));
}

function snapshot(positions: PositionInput[], total: number): ConcentrationSnapshot {
  const { companies } = computeLookThrough(positions, total);
  return {
    largestCompanyPct: (companies[0]?.weight ?? 0) * 100,
    largestCompanyLabel: companies[0]?.label ?? null,
    top5CompaniesPct: companies.slice(0, 5).reduce((s, c) => s + c.weight, 0) * 100,
  };
}

export function analyzePurchase(
  assets: Asset[],
  proposal: PurchaseProposal,
  context: PurchaseContext = {},
): PurchaseAnalysis {
  const open = assets.filter(isOpenPosition);
  const currentTotal = open.reduce((s, a) => s + assetCurrentValue(a), 0);
  const amount = Math.max(0, Number(proposal.amount) || 0);
  const proposedTotal = currentTotal + amount;
  const existing = proposal.assetId ? open.find((a) => a.id === proposal.assetId) : undefined;
  // Um ativo existente fixa a classe.
  const assetClass = existing?.class ?? proposal.assetClass;

  /* ---------- Alocação por classe (e alvos, se existirem) ---------- */
  const targetSum = (context.targets ?? []).reduce((s, t) => s + Math.max(0, t.targetPct), 0);
  const hasTargets = targetSum > 0;
  const targetOf = (c: AssetClass): number | null => {
    if (!hasTargets) return null;
    const t = context.targets!.find((x) => x.key === c);
    return ((t ? Math.max(0, t.targetPct) : 0) / targetSum) * 100;
  };

  const allocation: AllocationDelta[] = CLASS_ORDER.map((c) => {
    const currentValue = open
      .filter((a) => a.class === c)
      .reduce((s, a) => s + assetCurrentValue(a), 0);
    const proposedValue = currentValue + (c === assetClass ? amount : 0);
    const currentPct = currentTotal > 0 ? (currentValue / currentTotal) * 100 : 0;
    const proposedPct = proposedTotal > 0 ? (proposedValue / proposedTotal) * 100 : 0;
    return {
      class: c,
      label: CLASS_LABELS[c],
      currentPct,
      proposedPct,
      deltaPct: proposedPct - currentPct,
      currentValue,
      proposedValue,
      targetPct: targetOf(c),
    };
  }).filter((x) => x.currentValue > 0 || x.proposedValue > 0 || (x.targetPct ?? 0) > 0);

  /* ---------- Concentração por empresa (look-through) ---------- */
  const withHoldings = (context.positions ?? []).filter((p) => p.value > 0);
  const lookThrough = withHoldings.some((p) => p.holdings.length > 0);
  const basePositions = withHoldings.length > 0 ? withHoldings : directPositions(open);
  const baseTotal = basePositions.reduce((s, p) => s + Math.max(0, p.value), 0);

  let afterPositions: PositionInput[];
  if (existing && basePositions.some((p) => p.assetId === existing.id)) {
    afterPositions = basePositions.map((p) =>
      p.assetId === existing.id ? { ...p, value: p.value + amount } : p,
    );
  } else if (assetClass === "etf") {
    // ETF novo: a composição ainda não é conhecida; conta no total, mas não
    // como uma empresa (um ETF é diversificado por dentro).
    afterPositions = basePositions;
  } else {
    afterPositions = [
      ...basePositions,
      {
        assetId: existing?.id ?? "__nova_compra__",
        name: existing?.name ?? proposal.name,
        class: assetClass,
        ticker: existing?.ticker ?? null,
        value: amount,
        nativeCurrency: "EUR",
        exposures: [],
        holdings: [],
      },
    ];
  }
  const before = snapshot(basePositions, baseTotal);
  const after = snapshot(afterPositions, baseTotal + amount);

  /* ---------- Avisos e notas ---------- */
  const alerts: string[] = [];
  const notes: string[] = [];
  if (amount <= 0) alerts.push("Indica um montante de compra superior a zero.");

  if (
    after.largestCompanyPct > LARGEST_COMPANY_LIMIT &&
    after.largestCompanyPct > before.largestCompanyPct + EPSILON
  )
    alerts.push(
      `A exposição a ${after.largestCompanyLabel ?? "uma empresa"} passaria a ${formatPct(after.largestCompanyPct)} da carteira (acima de ${formatPct(LARGEST_COMPANY_LIMIT, 0)}).`,
    );
  if (
    after.top5CompaniesPct > TOP5_COMPANIES_LIMIT &&
    after.top5CompaniesPct > before.top5CompaniesPct + EPSILON
  )
    alerts.push(
      `As 5 maiores empresas passariam a somar ${formatPct(after.top5CompaniesPct)} da carteira (acima de ${formatPct(TOP5_COMPANIES_LIMIT, 0)}).`,
    );

  const row = allocation.find((x) => x.class === assetClass);
  if (row && row.targetPct != null && amount > 0) {
    const driftBefore = row.currentPct - row.targetPct;
    const driftAfter = row.proposedPct - row.targetPct;
    if (driftAfter > EPSILON && driftAfter > driftBefore)
      alerts.push(
        `${row.label} ficaria ${formatPp(driftAfter)} acima do alvo (${formatPct(row.targetPct)}).`,
      );
    else if (Math.abs(driftAfter) < Math.abs(driftBefore))
      notes.push(`A compra aproxima ${row.label} do alvo (${formatPct(row.targetPct)}).`);
  }

  return {
    currentTotal,
    proposedTotal,
    purchasePct: proposedTotal > 0 ? (amount / proposedTotal) * 100 : 0,
    allocation,
    before,
    after,
    lookThrough,
    hasTargets,
    alerts,
    notes,
  };
}
