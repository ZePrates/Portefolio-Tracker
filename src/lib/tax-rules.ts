/**
 * Regras do Código do IRS usadas no resumo fiscal — lógica pura e testável.
 *
 * - Exclusão parcial por período de detenção (art. 43.º, n.º 5, red. Lei 31/2024).
 * - Limite do último escalão (englobamento obrigatório de curto prazo).
 * - Reporte de menos-valias por 5 anos, só em anos com englobamento.
 * - Reconciliação entre relatórios oficiais e os valores da app.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Aniversário de calendário n anos depois. Se o dia não existir no mês (29/02
 * em ano comum), conta o último dia desse mês (art. 279.º, c), Código Civil).
 */
export function calendarAnniversary(iso: string, years: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const ty = y + years;
  const last = new Date(Date.UTC(ty, m, 0)).getUTCDate();
  return `${ty}-${pad(m)}-${pad(Math.min(d, last))}`;
}

export type ExcludedPct = 0 | 0.1 | 0.2 | 0.3;

/** Anos completos de detenção e % do saldo excluída (art. 43.º, n.º 5 CIRS). */
export function holdingExclusion(
  acquisitionDate: string,
  realizationDate: string,
): { years: number; excludedPct: ExcludedPct } {
  const real = realizationDate.slice(0, 10);
  let years = 0;
  while (years < 200 && calendarAnniversary(acquisitionDate, years + 1) <= real) years++;
  let excludedPct: ExcludedPct = 0;
  if (real >= calendarAnniversary(acquisitionDate, 8)) excludedPct = 0.3;
  else if (real >= calendarAnniversary(acquisitionDate, 5)) excludedPct = 0.2;
  else if (real > calendarAnniversary(acquisitionDate, 2)) excludedPct = 0.1;
  return { years, excludedPct };
}

/** Classes a que se aplica a exclusão (valores mobiliários cotados e OIC abertos). */
export function holdingExclusionApplies(assetClass: string | null | undefined): boolean {
  return (
    assetClass === "etf" ||
    assetClass === "reit" ||
    assetClass === "acao_dividendo" ||
    assetClass === "acao_crescimento"
  );
}

/** Limite inferior do último escalão de IRS por ano de rendimentos (EUR). */
export const LAST_BRACKET_THRESHOLD: Readonly<Record<number, number>> = {
  2025: 83_696,
  2026: 86_634,
};

export function lastBracketThreshold(year: number): { threshold: number; confirmed: boolean } {
  const known = LAST_BRACKET_THRESHOLD[year];
  if (known != null) return { threshold: known, confirmed: true };
  const latest = Math.max(...Object.keys(LAST_BRACKET_THRESHOLD).map(Number));
  return { threshold: LAST_BRACKET_THRESHOLD[latest]!, confirmed: false };
}

/** Englobamento obrigatório do saldo positivo de lotes com < 365 dias. */
export function mandatoryAggregation(input: {
  year: number;
  shortTermGains: number;
  taxableIncome: number | null | undefined;
}): { applies: boolean; shortTermGains: number; threshold: number } | null {
  if (input.taxableIncome == null) return null;
  const { threshold } = lastBracketThreshold(input.year);
  const st = round2(input.shortTermGains);
  return {
    applies: st > 0 && input.taxableIncome + st >= threshold,
    shortTermGains: st,
    threshold,
  };
}

export interface YearGains {
  year: number;
  /** Saldo tributável do ano (após exclusão por detenção). */
  taxableNetGains: number;
  optedAggregation: boolean;
}

export interface LossPool {
  /** Ano de origem da perda; null = valor manual (anos anteriores fora da app). */
  originYear: number | null;
  amount: number;
  /** Último ano em que pode ser usada. */
  expiresAfter: number | null;
}

export const LOSS_CARRYFORWARD_YEARS = 5;

/**
 * Menos-valias reportáveis: um saldo negativo num ano com englobamento pode ser
 * deduzido nos 5 anos seguintes, só em anos com englobamento, mais antigas primeiro.
 */
export function lossCarryforward(input: {
  year: number;
  history: YearGains[];
  manual: number;
  currentTaxableGains: number;
  currentOpted: boolean;
}): { available: number; applied: number; remaining: number; pools: LossPool[] } {
  let pools: LossPool[] = [];
  const expire = (y: number) => {
    pools = pools.filter((p) => p.expiresAfter == null || p.expiresAfter >= y);
  };
  const consume = (gain: number): number => {
    let left = gain;
    let used = 0;
    for (const p of pools) {
      if (left <= 0) break;
      const take = Math.min(p.amount, left);
      p.amount = round2(p.amount - take);
      left -= take;
      used += take;
    }
    pools = pools.filter((p) => p.amount > 0);
    return round2(used);
  };

  const hist = [...input.history].filter((h) => h.year < input.year).sort((a, b) => a.year - b.year);
  for (const h of hist) {
    expire(h.year);
    if (!h.optedAggregation) continue;
    if (h.taxableNetGains > 0) consume(h.taxableNetGains);
    else if (h.taxableNetGains < 0)
      pools.push({
        originYear: h.year,
        amount: round2(-h.taxableNetGains),
        expiresAfter: h.year + LOSS_CARRYFORWARD_YEARS,
      });
  }
  expire(input.year);
  if (input.manual > 0) pools.unshift({ originYear: null, amount: round2(input.manual), expiresAfter: null });
  const available = round2(pools.reduce((s, p) => s + p.amount, 0));
  const snapshot = pools.map((p) => ({ ...p }));
  const applied =
    input.currentOpted && input.currentTaxableGains > 0 ? consume(input.currentTaxableGains) : 0;
  return { available, applied, remaining: round2(available - applied), pools: snapshot };
}

/* ------------------------------------------------------------------ */
/* Reconciliação com relatórios oficiais                               */
/* ------------------------------------------------------------------ */

export type TaxDocSource = "xtb" | "scramble" | "elementum" | "other";

export interface OfficialTotals {
  source: TaxDocSource;
  realization_value?: number | null;
  acquisition_value?: number | null;
  expenses?: number | null;
  net_gains?: number | null;
  dividends_gross?: number | null;
  dividends_tax_withheld?: number | null;
  interest_gross?: number | null;
  interest_tax_withheld?: number | null;
}

export interface AppSourceTotals {
  xtb: {
    realizationValue: number;
    acquisitionValue: number;
    expenses: number;
    netGains: number;
    dividendsGross: number;
    dividendsTaxWithheld: number;
  };
  scramble: { interestGross: number; interestTaxWithheld: number };
}

export interface ReconciliationRow {
  label: string;
  official: number;
  app: number | null;
  diff: number | null;
  status: "confere" | "diverge" | "sem-comparacao";
}

export const RECONCILE_TOLERANCE = 0.5;

export function reconcileDocument(doc: OfficialTotals, app: AppSourceTotals): ReconciliationRow[] {
  const x = doc.source === "xtb" ? app.xtb : null;
  const s = doc.source === "scramble" ? app.scramble : null;
  const fields: Array<[string, number | null | undefined, number | null]> = [
    ["Valor de realização", doc.realization_value, x?.realizationValue ?? null],
    ["Valor de aquisição", doc.acquisition_value, x?.acquisitionValue ?? null],
    ["Despesas e encargos", doc.expenses, x?.expenses ?? null],
    ["Saldo de mais-valias", doc.net_gains, x?.netGains ?? null],
    ["Dividendos brutos", doc.dividends_gross, x?.dividendsGross ?? null],
    ["Imposto retido (dividendos)", doc.dividends_tax_withheld, x?.dividendsTaxWithheld ?? null],
    ["Juros brutos", doc.interest_gross, s?.interestGross ?? null],
    ["Imposto retido (juros)", doc.interest_tax_withheld, s?.interestTaxWithheld ?? null],
  ];
  const rows: ReconciliationRow[] = [];
  for (const [label, off, appV] of fields) {
    if (off == null || !Number.isFinite(Number(off))) continue;
    const official = round2(Number(off));
    if (appV == null) {
      rows.push({ label, official, app: null, diff: null, status: "sem-comparacao" });
      continue;
    }
    const diff = round2(official - appV);
    rows.push({
      label,
      official,
      app: round2(appV),
      diff,
      status: Math.abs(diff) <= RECONCILE_TOLERANCE ? "confere" : "diverge",
    });
  }
  return rows;
}

export function hasOfficialTotals(doc: OfficialTotals): boolean {
  return [
    doc.realization_value,
    doc.acquisition_value,
    doc.expenses,
    doc.net_gains,
    doc.dividends_gross,
    doc.dividends_tax_withheld,
    doc.interest_gross,
    doc.interest_tax_withheld,
  ].some((v) => v != null);
}

/* ------------------------------------------------------------------ */
/* Ficheiros                                                           */
/* ------------------------------------------------------------------ */

export const TAX_DOC_MAX_BYTES = 10 * 1024 * 1024;
export const TAX_DOC_MIME = [
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Valida tipo e tamanho; devolve o MIME a usar ou uma mensagem de erro. */
export function validateTaxFile(file: {
  name: string;
  size: number;
  type: string;
}): { ok: true; mime: string } | { ok: false; error: string } {
  if (file.size > TAX_DOC_MAX_BYTES) return { ok: false, error: "O ficheiro excede 10 MB." };
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = (TAX_DOC_MIME as readonly string[]).includes(file.type) ? file.type : EXT_MIME[ext];
  if (!mime || !EXT_MIME[ext]) return { ok: false, error: "Só são aceites PDF, CSV, XLS ou XLSX." };
  return { ok: true, mime };
}

export function sanitizeFileName(name: string): string {
  const clean = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (clean || "ficheiro").slice(-120);
}

export function taxDocPath(userId: string, year: number, uuid: string, name: string): string {
  return `${userId}/${year}/${uuid}-${sanitizeFileName(name)}`;
}
