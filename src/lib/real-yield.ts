/**
 * Yield real a partir dos dividendos efetivamente pagos (extrato XTB) —
 * lógica pura, sem rede.
 *
 * Porquê: o yield estimado pelo histórico do Yahoo e o do Finnhub erravam em
 * casos reais (dividendos especiais da HST contados como regulares, cotações
 * desatualizadas no Finnhub). Os pagamentos recebidos são a fonte mais fiável.
 *
 * Como a XTB grava os pagamentos:
 *  - uma linha por lote de compra (9 + 8 ações → duas linhas no mesmo dia);
 *  - o dividendo especial pode vir em linhas próprias;
 *  - a linha com `ex_date` traz o dividendo TOTAL por ação desse pagamento
 *    (ex.: HST 0,92 $ = 0,20 regular + 0,72 especial).
 * Por isso agrupa-se por data de pagamento e usa-se a linha com ex-date.
 */
import { addDaysISO } from "@/lib/dates";
import { frequencyLabel, inferPaymentsPerYear } from "@/lib/yield";

export interface DividendLine {
  ex_date?: string | null;
  payment_date?: string | null;
  paid_at: string;
  per_share_native?: number | string | null;
  status?: string | null;
  source?: string | null;
}

export interface PaymentEvent {
  /** Ex-date (ou data de pagamento quando não há), YYYY-MM-DD. */
  date: string;
  /** Dividendo total por ação, na moeda do título. */
  dps: number;
  /** Parte regular e parte especial (soma = dps). */
  regular: number;
  special: number;
}

export interface RealYield {
  paymentsPerYear: number;
  frequency: string | null;
  /** Dividendo anual regular por ação (moeda do título). */
  forwardDps: number;
  /** Yield atual: dividendo regular anualizado ÷ cotação, em %. */
  forwardPct: number;
  /** Soma dos últimos 12 meses (inclui especiais), por ação. */
  ttmDps: number;
  ttmPct: number;
  /** true quando a posição tem menos de um ano de pagamentos. */
  ttmPartial: boolean;
  /** Especiais nos últimos 12 meses, por ação. */
  ttmSpecialDps: number;
  events: PaymentEvent[];
}

/** Acima deste múltiplo do pagamento típico, a diferença conta como especial. */
export const SPECIAL_FACTOR = 1.5;
/** Tributação final em Portugal (taxa liberatória, sem englobamento). */
export const PT_DIVIDEND_TAX = 0.28;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Um evento por pagamento. Só pagamentos recebidos; se o ativo tem linhas da
 * XTB, usam-se só essas (as do Yahoo são estimativas da mesma coisa). Com
 * `today`, junta os anunciados com ex-date já passada e ainda por pagar.
 */
export function paymentEvents(
  lines: DividendLine[],
  today?: string,
): Array<{ date: string; dps: number }> {
  const received = lines.filter((l) => (l.status ?? "received") === "received");
  const hasXtb = received.some((l) => l.source === "xtb");
  const rows = hasXtb ? received.filter((l) => l.source === "xtb") : received;
  // Ex-date já passada mas ainda por pagar (ex.: MAA, ex 15/10, paga 31/10): o
  // direito ao dividendo já existe, por isso conta — só se for posterior ao
  // último pagamento registado, para nunca duplicar.
  if (today) {
    const lastEx = rows.reduce((m, l) => {
      const d = (l.ex_date ?? l.payment_date ?? l.paid_at).slice(0, 10);
      return d > m ? d : m;
    }, "");
    const pending = lines.filter(
      (l) =>
        l.status === "scheduled" &&
        l.ex_date &&
        l.ex_date <= today &&
        l.ex_date > addDaysISO(lastEx || "0000-01-01", 10),
    );
    rows.push(...pending);
  }

  const byPayment = new Map<string, DividendLine[]>();
  for (const l of rows) {
    if (num(l.per_share_native) == null) continue;
    const key = (l.payment_date ?? l.paid_at).slice(0, 10);
    byPayment.set(key, [...(byPayment.get(key) ?? []), l]);
  }

  const out: Array<{ date: string; dps: number }> = [];
  for (const [payDate, group] of byPayment) {
    const withEx = group.filter((l) => l.ex_date);
    const pick = (withEx.length ? withEx : group)
      .map((l) => ({ ex: l.ex_date ?? null, dps: num(l.per_share_native)! }))
      .sort((a, b) => b.dps - a.dps)[0]!;
    out.push({ date: (pick.ex ?? payDate).slice(0, 10), dps: pick.dps });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Separa a parte especial: o que passa de SPECIAL_FACTOR × o pagamento típico. */
export function classifyEvents(
  events: Array<{ date: string; dps: number }>,
  paymentsPerYear: number,
): PaymentEvent[] {
  const window = Math.min(12, Math.max(4, paymentsPerYear * 2));
  const interval = 365 / paymentsPerYear;
  const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
  // Um pagamento pertence ao regime atual se veio ~1 intervalo depois do anterior.
  // Assim, numa mudança de frequência (STAG: mensal 0,124 → trimestral 0,388),
  // os novos pagamentos não são comparados com os antigos e não passam por especiais.
  const fits = (j: number) => {
    if (j === 0) return false;
    const d = days(events[j - 1]!.date, events[j]!.date);
    return d >= interval * 0.6 && d <= interval * 1.4;
  };
  return events.map((e, i) => {
    let start = i;
    while (start > 0 && i - start + 1 < window && fits(start)) start--;
    if (!fits(start) && start < i) start++;
    const recent = events.slice(start, i + 1).map((x) => x.dps);
    const typical = median(recent);
    if (recent.length >= 3 && e.dps > typical * SPECIAL_FACTOR) {
      return { ...e, regular: typical, special: e.dps - typical };
    }
    return { ...e, regular: e.dps, special: 0 };
  });
}

/**
 * Yield real de um título. null quando não há pagamentos suficientes para
 * inferir a frequência (≥ 3), quando o último pagamento é antigo de mais
 * (importação em atraso ou dividendo suspenso) ou sem cotação — nesses casos
 * usa-se a estimativa do Yahoo.
 */
export function realYield(
  lines: DividendLine[],
  priceNative: number,
  today: string,
): RealYield | null {
  if (!(priceNative > 0)) return null;
  const raw = paymentEvents(lines, today);
  const perYear = inferPaymentsPerYear(raw.map((e) => ({ date: e.date, amount: e.dps })));
  if (!perYear) return null;

  const events = classifyEvents(raw, perYear);
  const last = events[events.length - 1]!;
  const interval = 365 / perYear;
  if (last.date < addDaysISO(today, -Math.round(2 * interval + 45))) return null;

  // Frequências de 1–2 pagamentos por ano têm muitas vezes valores desiguais
  // (dividendo intercalar + final, como a Novo Nordisk): soma-se o último ano.
  // Mensal/trimestral: último regular × frequência, que reflete logo aumentos e cortes.
  const forwardDps =
    perYear <= 2 && events.length >= perYear
      ? events.slice(-perYear).reduce((s, e) => s + e.regular, 0)
      : last.regular * perYear;

  const yearAgo = addDaysISO(today, -365);
  const ttm = events.filter((e) => e.date > yearAgo && e.date <= today);
  const ttmDps = ttm.reduce((s, e) => s + e.dps, 0);

  return {
    paymentsPerYear: perYear,
    frequency: frequencyLabel(perYear),
    forwardDps,
    forwardPct: (forwardDps / priceNative) * 100,
    ttmDps,
    ttmPct: (ttmDps / priceNative) * 100,
    ttmPartial: events[0]!.date > yearAgo,
    ttmSpecialDps: ttm.reduce((s, e) => s + e.special, 0),
    events,
  };
}

/**
 * Yield sobre o custo, em EUR: dividendo anual regular convertido ao câmbio de
 * hoje ÷ preço médio pago em EUR. É o rendimento que o dinheiro investido dá hoje.
 */
export function yieldOnCost(
  forwardDpsNative: number,
  fxToEur: number,
  averageCostEur: number,
): number | null {
  if (!(forwardDpsNative > 0) || !(fxToEur > 0) || !(averageCostEur > 0)) return null;
  return ((forwardDpsNative * fxToEur) / averageCostEur) * 100;
}

/**
 * Yield líquido estimado para um residente em Portugal sem englobamento: a
 * retenção no estrangeiro é crédito sobre os 28%, por isso a carga total é a
 * maior das duas (EUA 15% → 28%; Dinamarca 27% → 28%).
 */
export function netYield(grossPct: number, foreignWithholding: number): number {
  return grossPct * (1 - Math.max(PT_DIVIDEND_TAX, Math.max(0, foreignWithholding)));
}
