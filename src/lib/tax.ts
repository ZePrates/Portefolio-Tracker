/**
 * Fiscalidade de dividendos para um residente fiscal em Portugal — lógica pura.
 *
 * Retenção na fonte no país do emitente (aplicada pelo broker antes do
 * crédito). Valores por omissão = taxas estatutárias/convenção mais comuns
 * para pessoas singulares residentes em PT; são APROXIMAÇÕES editáveis por
 * ativo (`assets.withholding_rate`). Fundos UCITS domiciliados na Irlanda ou
 * no Luxemburgo não retêm na distribuição.
 */

/** Retenção sobre dividendos de ações, por país (fração 0..1). */
export const STOCK_WITHHOLDING: Readonly<Record<string, number>> = {
  US: 0.15, // com W-8BEN (XTB)
  CA: 0.25,
  GB: 0,
  IE: 0.25,
  DE: 0.26375,
  FR: 0.128,
  NL: 0.15,
  BE: 0.3,
  LU: 0.15,
  ES: 0.19,
  IT: 0.26,
  PT: 0.28,
  CH: 0.35,
  AT: 0.275,
  DK: 0.27,
  SE: 0.3,
  NO: 0.25,
  FI: 0.35,
  PL: 0.19,
  JP: 0.15315,
  AU: 0,
  HK: 0,
  SG: 0,
};

/** Fundos (ETFs) por domicílio: UCITS IE/LU não retêm na distribuição. */
export const FUND_WITHHOLDING: Readonly<Record<string, number>> = {
  IE: 0,
  LU: 0,
  DE: 0.26375,
  FR: 0.128,
  NL: 0.15,
  US: 0.15,
  GB: 0,
};

/** Sufixos de bolsa (Yahoo e formato XTB) → país. Sem sufixo → EUA. */
const SUFFIX_COUNTRY: Readonly<Record<string, string>> = {
  US: "US",
  L: "GB",
  UK: "GB",
  AS: "NL",
  NL: "NL",
  DE: "DE",
  F: "DE",
  XETRA: "DE",
  PA: "FR",
  FR: "FR",
  MC: "ES",
  ES: "ES",
  MI: "IT",
  IT: "IT",
  LS: "PT",
  PT: "PT",
  BR: "BE",
  BE: "BE",
  SW: "CH",
  CH: "CH",
  VI: "AT",
  CO: "DK",
  DK: "DK",
  ST: "SE",
  SE: "SE",
  OL: "NO",
  NO: "NO",
  HE: "FI",
  FI: "FI",
  WA: "PL",
  PL: "PL",
  TO: "CA",
  T: "JP",
  AX: "AU",
  HK: "HK",
  SI: "SG",
  IR: "IE",
};

export interface TaxableAsset {
  class: string;
  isin?: string | null;
  ticker?: string | null;
  withholding_rate?: number | null;
  /** Domicílio conhecido (ex.: asset_profiles.domicile_country). */
  domicile?: string | null;
}

/** País de domicílio do emitente: ISIN → perfil → sufixo do ticker → EUA (sem sufixo). */
export function domicileOf(asset: TaxableAsset): string | null {
  const isin = asset.isin?.trim().toUpperCase();
  if (isin && /^[A-Z]{2}/.test(isin)) return isin.slice(0, 2);
  const dom = asset.domicile?.trim().toUpperCase();
  if (dom && /^[A-Z]{2}$/.test(dom)) return dom;
  const ticker = asset.ticker?.trim().toUpperCase();
  if (!ticker) return null;
  const dot = ticker.lastIndexOf(".");
  if (dot < 0) return "US";
  return SUFFIX_COUNTRY[ticker.slice(dot + 1)] ?? null;
}

export type WithholdingSource = "asset" | "default" | "unknown";

export interface WithholdingRate {
  rate: number;
  source: WithholdingSource;
  country: string | null;
}

/** Retenção a aplicar: a do ativo (se definida) ou a por omissão do domicílio. */
export function withholdingRateFor(asset: TaxableAsset): WithholdingRate {
  const country = domicileOf(asset);
  const own = asset.withholding_rate;
  if (typeof own === "number" && Number.isFinite(own) && own >= 0 && own < 1) {
    return { rate: own, source: "asset", country };
  }
  if (!country) return { rate: 0, source: "unknown", country: null };
  const table = asset.class === "etf" ? FUND_WITHHOLDING : STOCK_WITHHOLDING;
  const rate = table[country];
  if (rate === undefined) return { rate: 0, source: "unknown", country };
  return { rate, source: "default", country };
}

/** Imposto retido (EUR), arredondado ao cêntimo como no extrato. */
export function withholdingAmount(grossEur: number, rate: number): number {
  if (!(grossEur > 0) || !(rate > 0)) return 0;
  return Math.round(grossEur * rate * 100) / 100;
}

/**
 * Desfasamento por omissão entre a data ex-dividendo e o pagamento, usado
 * enquanto o ativo não tem pagamentos confirmados que cheguem para medir o
 * seu (ver `paymentLagByAsset`). O Yahoo só publica a ex-date; a data de
 * pagamento real vem do extrato do broker.
 */
export const DEFAULT_PAYMENT_LAG_DAYS = 14;

export function estimatePaymentDate(exDate: string, lagDays = DEFAULT_PAYMENT_LAG_DAYS): string {
  const d = new Date(`${exDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + lagDays);
  return d.toISOString().slice(0, 10);
}

/** Pagamentos confirmados mínimos de um ativo para confiar no seu desfasamento. */
export const MIN_LAG_SAMPLES = 2;
/** Só os pagamentos confirmados mais recentes contam: o desfasamento muda devagar. */
const MAX_LAG_SAMPLES = 8;
/** Fora deste intervalo (dias) o par ex-date/pagamento é dado mau, não desfasamento. */
const MIN_PLAUSIBLE_LAG_DAYS = 1;
const MAX_PLAUSIBLE_LAG_DAYS = 60;

export interface PaymentLagRecord {
  asset_id?: string | null;
  ex_date?: string | null;
  payment_date?: string | null;
  /** Só os registos confirmados (`false`) medem o desfasamento real. */
  payment_date_estimated?: boolean | null;
}

function daysBetweenISO(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Desfasamento típico (mediana, em dias) entre ex-date e pagamento de UM
 * ativo, medido nos pagamentos confirmados (extrato do broker). Devolve
 * `null` se houver menos de `MIN_LAG_SAMPLES` amostras plausíveis, para quem
 * chama cair nos `DEFAULT_PAYMENT_LAG_DAYS`.
 */
export function medianPaymentLag(records: readonly PaymentLagRecord[]): number | null {
  const samples = records
    .filter((r) => r.payment_date_estimated === false && r.ex_date && r.payment_date)
    .map((r) => ({
      exDate: r.ex_date!.slice(0, 10),
      lag: daysBetweenISO(r.ex_date!, r.payment_date!),
    }))
    .filter((s) => s.lag >= MIN_PLAUSIBLE_LAG_DAYS && s.lag <= MAX_PLAUSIBLE_LAG_DAYS)
    .sort((a, b) => b.exDate.localeCompare(a.exDate))
    .slice(0, MAX_LAG_SAMPLES)
    .map((s) => s.lag)
    .sort((a, b) => a - b);
  if (samples.length < MIN_LAG_SAMPLES) return null;
  const mid = Math.floor(samples.length / 2);
  return samples.length % 2 === 1
    ? samples[mid]!
    : Math.round((samples[mid - 1]! + samples[mid]!) / 2);
}

/**
 * Desfasamento por ativo (`asset_id` → dias). Só inclui ativos com amostras
 * suficientes; para os restantes, `estimatePaymentDate` usa o valor por omissão.
 */
export function paymentLagByAsset(records: readonly PaymentLagRecord[]): Map<string, number> {
  const byAsset = new Map<string, PaymentLagRecord[]>();
  for (const r of records) {
    if (!r.asset_id) continue;
    const list = byAsset.get(r.asset_id) ?? [];
    list.push(r);
    byAsset.set(r.asset_id, list);
  }
  const out = new Map<string, number>();
  for (const [assetId, list] of byAsset) {
    const lag = medianPaymentLag(list);
    if (lag != null) out.set(assetId, lag);
  }
  return out;
}
