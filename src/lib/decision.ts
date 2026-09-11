import {
  assetCurrentValue,
  CLASS_LABELS,
  isOpenPosition,
  type Asset,
  type AssetClass,
} from "@/lib/portfolio-types";

export interface PurchaseProposal {
  amount: number;
  assetClass: AssetClass;
  assetId?: string;
  name: string;
}
export interface AllocationDelta {
  class: AssetClass;
  label: string;
  currentPct: number;
  proposedPct: number;
  deltaPct: number;
  currentValue: number;
  proposedValue: number;
}
export interface PurchaseAnalysis {
  currentTotal: number;
  proposedTotal: number;
  purchasePct: number;
  allocation: AllocationDelta[];
  largestAssetPctBefore: number;
  largestAssetPctAfter: number;
  concentrationAlert: boolean;
  classConcentrationAlert: boolean;
  diversificationScoreBefore: number;
  diversificationScoreAfter: number;
  alerts: string[];
}

export function analyzePurchase(assets: Asset[], proposal: PurchaseProposal): PurchaseAnalysis {
  const open = assets.filter(isOpenPosition);
  const currentTotal = open.reduce((s, a) => s + assetCurrentValue(a), 0);
  const amount = Math.max(0, Number(proposal.amount) || 0);
  const proposedTotal = currentTotal + amount;
  const classes = Object.keys(CLASS_LABELS) as AssetClass[];
  const allocation = classes
    .map((c) => {
      const currentValue = open
        .filter((a) => a.class === c)
        .reduce((s, a) => s + assetCurrentValue(a), 0);
      const proposedValue = currentValue + (c === proposal.assetClass ? amount : 0);
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
      };
    })
    .filter((x) => x.currentValue > 0 || x.proposedValue > 0);
  const existing = open.map((a) => ({ id: a.id, value: assetCurrentValue(a) }));
  const existingTarget = proposal.assetId ? open.find((a) => a.id === proposal.assetId) : undefined;
  const largestBefore =
    currentTotal > 0 ? (Math.max(0, ...existing.map((x) => x.value)) / currentTotal) * 100 : 0;
  const targetAfter = existingTarget ? assetCurrentValue(existingTarget) + amount : amount;
  const largestAfter =
    proposedTotal > 0
      ? (Math.max(
          targetAfter,
          ...existing.filter((x) => x.id !== proposal.assetId).map((x) => x.value),
        ) /
          proposedTotal) *
        100
      : 0;
  const hhi = (values: number[], total: number) =>
    total > 0 ? values.reduce((s, v) => s + (v / total) ** 2, 0) : 0;
  const score = (values: number[], total: number) => {
    if (values.length === 0) return 0;
    const n = Math.max(values.length, 2);
    const normalized = (1 - hhi(values, total)) / (1 - 1 / n);
    return Math.max(0, Math.min(100, normalized * 100));
  };
  const beforeScore = score(
    existing.map((x) => x.value),
    currentTotal,
  );
  const afterValues = existing
    .filter((x) => x.id !== proposal.assetId)
    .map((x) => x.value)
    .concat([targetAfter]);
  const afterScore = score(afterValues, proposedTotal);
  const alerts: string[] = [];
  if (largestAfter > 25)
    alerts.push(`Concentração elevada: a maior posição ficaria em ${largestAfter.toFixed(1)}%.`);
  const targetClass = allocation.find((x) => x.class === proposal.assetClass);
  if ((targetClass?.proposedPct ?? 0) > 40)
    alerts.push(`A classe ${CLASS_LABELS[proposal.assetClass]} ultrapassaria 40% da carteira.`);
  if (afterScore < beforeScore - 10)
    alerts.push("A compra reduz materialmente a diversificação da carteira.");
  if (amount <= 0) alerts.push("Indica um montante de compra superior a zero.");
  return {
    currentTotal,
    proposedTotal,
    purchasePct: proposedTotal > 0 ? (amount / proposedTotal) * 100 : 0,
    allocation,
    largestAssetPctBefore: largestBefore,
    largestAssetPctAfter: largestAfter,
    concentrationAlert: largestAfter > 25,
    classConcentrationAlert: (targetClass?.proposedPct ?? 0) > 40,
    diversificationScoreBefore: beforeScore,
    diversificationScoreAfter: afterScore,
    alerts,
  };
}
