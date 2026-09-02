export type AssetClass =
  | "etf"
  | "reit"
  | "acao_dividendo"
  | "acao_crescimento"
  | "metal"
  | "p2p";

export interface Asset {
  id: string;
  user_id: string;
  class: AssetClass;
  ticker: string | null;
  name: string;
  quantity: number;
  average_price: number;
  current_price: number;
  invested_amount: number;
  current_value: number;
  currency: string;
  metal_type: string | null;
  p2p_group: string | null;
  annual_yield: number | null;
  notes: string | null;
  native_currency: string;
  purchase_price_native: number | null;
  current_price_native: number | null;
  dividend_frequency: string | null;
  last_dividend_import: string | null;
  status: string;
  realized_pl: number;
  total_fees: number;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Dividend {
  id: string;
  user_id: string;
  asset_id: string | null;
  asset_name: string;
  /** Valor bruto em EUR (compatibilidade). */
  amount: number;
  paid_at: string;
  created_at: string;
  source?: string | null;
  per_share?: number | null;
  ex_date?: string | null;
  record_date?: string | null;
  payment_date?: string | null;
  currency?: string | null;
  per_share_native?: number | null;
  amount_native?: number | null;
  fx_rate?: number | null;
  fx_date?: string | null;
  gross_amount?: number | null;
  tax_amount?: number | null;
  fee_amount?: number | null;
  net_amount?: number | null;
  eligible_quantity?: number | null;
  source_event_id?: string | null;
  status?: string | null;
  updated_at?: string | null;
}


export interface Transaction {
  id: string;
  user_id: string;
  asset_id: string | null;
  type: "buy" | "sell";
  quantity: number;
  price: number;
  total: number;
  traded_at: string;
  created_at: string;
  fee: number;
  fee_native: number | null;
  native_currency: string;
  price_native: number | null;
  fx_rate: number;
  realized_pl: number | null;
  source: string;
  notes: string | null;
}

export const CLASS_LABELS: Record<AssetClass, string> = {
  etf: "ETFs",
  reit: "REITs",
  acao_dividendo: "Ações Dividendos",
  acao_crescimento: "Ações Crescimento",
  metal: "Metais Preciosos",
  p2p: "P2P",
};

/** Uma posição está aberta quando ainda há algo detido. */
export function isOpenPosition(a: Asset): boolean {
  if (a.status === "closed") return false;
  if (a.class === "p2p" || a.class === "metal") return (a.current_value || a.invested_amount || 0) > 0;
  return (a.quantity || 0) > 0;
}

/** Lucro/prejuízo já realizado (vendas concretizadas). */
export function assetRealizedPL(a: Asset): number {
  return a.realized_pl || 0;
}

/** Valor atual de um ativo (títulos: quantidade × preço; P2P/metais: valor corrente). */
export function assetCurrentValue(a: Asset): number {
  if (!isOpenPosition(a)) return 0;
  if (a.class === "p2p" || a.class === "metal") return a.current_value || 0;
  if (a.quantity > 0 && a.current_price > 0) return a.quantity * a.current_price;
  return a.current_value || 0;
}

/** Total investido num ativo (custo das unidades ainda detidas). */
export function assetInvested(a: Asset): number {
  if (!isOpenPosition(a)) return 0;
  if (a.class === "p2p" || a.class === "metal") return a.invested_amount || 0;
  if (a.quantity > 0 && a.average_price > 0) return a.quantity * a.average_price;
  return a.invested_amount || 0;
}

export function assetPL(a: Asset): { abs: number; pct: number } {
  const invested = assetInvested(a);
  const current = assetCurrentValue(a);
  const abs = current - invested;
  const pct = invested > 0 ? (abs / invested) * 100 : 0;
  return { abs, pct };
}
