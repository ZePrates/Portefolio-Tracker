export interface RawTrade {
  assetId: string;
  type: string;
  quantity: number | string;
  price: number | string;
  fee?: number | string | null;
  tradedAt: string;
  source?: string | null;
  sourceEventId?: string | null;
  nativeCurrency?: string | null;
  priceNative?: number | string | null;
  fxRate?: number | string | null;
  notes?: string | null;
}
export interface NormalizedTrade {
  assetId: string;
  type: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  tradedAt: string;
  source: string;
  sourceEventId: string | null;
  nativeCurrency: string;
  priceNative: number | null;
  fxRate: number;
  notes: string | null;
}
export function normalizeTrade(r: RawTrade): NormalizedTrade {
  const type = String(r.type).toLowerCase();
  if (type !== "buy" && type !== "sell") throw new Error(`Tipo de movimento inválido: ${r.type}`);
  const quantity = Number(r.quantity),
    price = Number(r.price),
    fee = Number(r.fee ?? 0);
  if (
    !r.assetId ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isFinite(fee) ||
    fee < 0
  )
    throw new Error("Movimento com valores inválidos.");
  const d = new Date(r.tradedAt);
  if (Number.isNaN(d.getTime())) throw new Error("Data do movimento inválida.");
  return {
    assetId: r.assetId,
    type,
    quantity,
    price,
    fee,
    tradedAt: r.tradedAt,
    source: r.source || "import",
    sourceEventId: r.sourceEventId || null,
    nativeCurrency: r.nativeCurrency || "EUR",
    priceNative: r.priceNative == null ? null : Number(r.priceNative),
    fxRate: Number(r.fxRate ?? 1) || 1,
    notes: r.notes || null,
  };
}
export function tradeFingerprint(t: NormalizedTrade): string {
  return t.sourceEventId
    ? `${t.source}:${t.sourceEventId}`
    : [
        t.assetId,
        t.type,
        t.tradedAt.slice(0, 19),
        t.quantity.toFixed(8),
        t.price.toFixed(8),
        t.fee.toFixed(8),
        t.nativeCurrency,
        t.priceNative == null ? "" : t.priceNative.toFixed(8),
      ].join("|");
}
export function dedupeTrades(rows: RawTrade[]): NormalizedTrade[] {
  const seen = new Set<string>();
  const out: NormalizedTrade[] = [];
  for (const r of rows) {
    const t = normalizeTrade(r),
      k = tradeFingerprint(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
