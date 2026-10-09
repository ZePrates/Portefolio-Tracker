/**
 * Scramble (P2P, Estónia) — lógica pura.
 *
 * A Scramble agrupa o investimento em rondas mensais com prazo de 6 meses.
 * Grupo A: devolve ~5,9% do capital por mês nos meses 1–5 e o resto no mês 6;
 * os juros (0,75%/mês sobre o capital em dívida, 1% com reforço mensal ≥ 100 €)
 * acumulam e só são pagos no vencimento. Grupo B: tudo no fim (capital + 9%).
 * Os pagamentos caem no dia 5 (ou no dia útil seguinte).
 *
 * Fonte dos dados: os dois CSV de Relatórios da conta Scramble —
 * "Movimentos de caixa" e "Movimentos do portefólio" (por ronda).
 */

import { splitCsvLine } from "@/lib/xtb";
import { xirr, type CashFlow } from "@/lib/performance";
import type { DividendRecord } from "@/lib/dividends";
import type { ProjectedDividend } from "@/lib/dividend-calendar";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type ScrambleCashType =
  | "deposit"
  | "withdrawal"
  | "purchase"
  | "principal"
  | "interest"
  | "interest_increased"
  | "bonus_noncash"
  | "bonus_cash"
  | "fee"
  | "other";

export const SCRAMBLE_CASH_TYPES: readonly ScrambleCashType[] = [
  "deposit",
  "withdrawal",
  "purchase",
  "principal",
  "interest",
  "interest_increased",
  "bonus_noncash",
  "bonus_cash",
  "fee",
  "other",
];

export const SCRAMBLE_CASH_LABELS: Record<ScrambleCashType, string> = {
  deposit: "Depósito",
  withdrawal: "Levantamento",
  purchase: "Compra de créditos",
  principal: "Reembolso de capital",
  interest: "Juros",
  interest_increased: "Juros aumentados",
  bonus_noncash: "Bónus (não monetário)",
  bonus_cash: "Bónus (dinheiro)",
  fee: "Comissão",
  other: "Outro",
};

export interface ScrambleCashRow {
  /** YYYY-MM-DD */
  date: string;
  type: ScrambleCashType;
  /** Tipo de operação tal como vem no extrato. */
  label: string;
  description: string;
  amount: number;
  balance: number | null;
  /** Ordem cronológica dentro do ficheiro (0 = mais antigo). */
  seq: number;
}

export interface ScrambleRoundRow {
  date: string;
  /** Mês da ronda, YYYY-MM. */
  roundKey: string;
  openingPrincipal: number;
  invested: number;
  principalRepaid: number;
  interestReceived: number;
  closingPrincipal: number;
  seq: number;
}

export type ScrambleReportKind = "cash" | "portfolio";

export interface ScrambleParseResult {
  kind: ScrambleReportKind;
  period: { from: string; to: string } | null;
  cash: ScrambleCashRow[];
  rounds: ScrambleRoundRow[];
  errors: string[];
}

/* ------------------------------------------------------------------ */
/* Leitura dos CSV                                                     */
/* ------------------------------------------------------------------ */

/** Minúsculas e sem acentos, para comparar rótulos PT/BR/EN. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** dd.mm.aaaa (ou dd/mm/aaaa, dd-mm-aaaa) → YYYY-MM-DD. */
export function parseScrambleDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const iso = `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : null;
}

/** Montantes do extrato: ponto decimal; tolera "€", espaços e vírgula decimal. */
export function parseScrambleAmount(s: string): number | null {
  let t = s.replace(/[€\s\u00a0]/g, "");
  if (t === "") return null;
  if (t.includes(",") && !t.includes(".")) t = t.replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
  jan: 1,
  feb: 2,
  fev: 2,
  mar: 3,
  apr: 4,
  abr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  ago: 8,
  sep: 9,
  set: 9,
  oct: 10,
  out: 10,
  nov: 11,
  dec: 12,
  dez: 12,
};

/** "September 2026" / "setembro 2026" / "2026-09" → "2026-09". */
export function parseRoundKey(s: string): string | null {
  const t = norm(s);
  const iso = t.match(/^(\d{4})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const m = t.match(/^([a-z]+)\.?\s+(?:de\s+)?(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1]!];
  return month ? `${m[2]}-${String(month).padStart(2, "0")}` : null;
}

/** Classifica o tipo de operação do extrato de caixa. */
export function classifyCashType(label: string): ScrambleCashType {
  const t = norm(label);
  if (/juros aumentad|increased (interest|income)/.test(t)) return "interest_increased";
  if (/juros|interest/.test(t)) return "interest";
  if (/(bonus|bonus).*(nao monetario|non.?cash|non.?monetary)/.test(t)) return "bonus_noncash";
  if (/bonus|reward|recompensa/.test(t)) return "bonus_cash";
  if (/reembolso do principal|principal/.test(t)) return "principal";
  if (/cessao|credito|claim|adquirid/.test(t)) return "purchase";
  if (/levantamento|withdraw|saque|retirada/.test(t)) return "withdrawal";
  if (/deposito|deposit|recarga|top.?up/.test(t)) return "deposit";
  if (/taxa|comissao|fee|iva|vat/.test(t)) return "fee";
  return "other";
}

/**
 * Lê um CSV exportado em Relatórios (Movimentos de caixa ou do portefólio).
 * O cabeçalho do relatório (titular, período…) é ignorado, exceto o período,
 * que delimita o intervalo que a importação substitui.
 */
export function parseScrambleCsv(text: string): ScrambleParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const errors: string[] = [];
  let period: ScrambleParseResult["period"] = null;
  let kind: ScrambleReportKind | null = null;
  let headerIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!, ",").map((c) => c.trim());
    const first = norm(cells[0] ?? "");
    if (!period && /^(periodo|period)$/.test(first) && cells[1]) {
      const parts = cells[1].split(/\s*[–—-]\s*/);
      const from = parseScrambleDate(parts[0] ?? "");
      const to = parseScrambleDate(parts[1] ?? "");
      if (from && to) period = { from, to };
    }
    if (/^(data|date)$/.test(first) && cells.length >= 5) {
      const second = norm(cells[1] ?? "");
      if (/^(ronda|rodada|round)/.test(second)) kind = "portfolio";
      else if (/^(tipo|type)/.test(second)) kind = "cash";
      if (kind) {
        headerIdx = i;
        break;
      }
    }
  }

  if (!kind) {
    return {
      kind: "cash",
      period,
      cash: [],
      rounds: [],
      errors: [
        "Não reconheço este ficheiro. Exporta em CSV, na Scramble, os relatórios Movimentos de caixa ou Movimentos de portfólio.",
      ],
    };
  }

  const body: string[][] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    body.push(splitCsvLine(line, ",").map((c) => c.trim()));
  }

  const cash: ScrambleCashRow[] = [];
  const rounds: ScrambleRoundRow[] = [];
  // O extrato vem do mais recente para o mais antigo: seq inverte essa ordem.
  const n = body.length;
  body.forEach((cells, idx) => {
    const lineNo = headerIdx + 2 + idx;
    const date = parseScrambleDate(cells[0] ?? "");
    if (!date) {
      errors.push(`Linha ${lineNo}: data inválida "${cells[0] ?? ""}".`);
      return;
    }
    const seq = n - 1 - idx;
    if (kind === "cash") {
      const label = cells[1] ?? "";
      const amount = parseScrambleAmount(cells[3] ?? "");
      if (amount == null) {
        errors.push(`Linha ${lineNo}: montante inválido "${cells[3] ?? ""}".`);
        return;
      }
      cash.push({
        date,
        type: classifyCashType(label),
        label,
        description: cells[2] ?? "",
        amount,
        balance: parseScrambleAmount(cells[4] ?? ""),
        seq,
      });
    } else {
      const roundKey = parseRoundKey(cells[1] ?? "");
      const nums = cells.slice(2, 7).map(parseScrambleAmount);
      if (!roundKey || nums.some((v) => v == null)) {
        errors.push(`Linha ${lineNo}: linha de ronda inválida.`);
        return;
      }
      const [opening, invested, repaid, interest, closing] = nums as number[];
      rounds.push({
        date,
        roundKey,
        openingPrincipal: opening!,
        invested: invested!,
        principalRepaid: repaid!,
        interestReceived: interest!,
        closingPrincipal: closing!,
        seq,
      });
    }
  });

  if (cash.length + rounds.length === 0 && errors.length === 0) {
    errors.push("O ficheiro não tem movimentos.");
  }
  if (!period) {
    const dates = [...cash.map((c) => c.date), ...rounds.map((r) => r.date)].sort();
    if (dates.length > 0) period = { from: dates[0]!, to: dates[dates.length - 1]! };
  }
  return { kind, period, cash, rounds, errors };
}

/* ------------------------------------------------------------------ */
/* Calendário                                                          */
/* ------------------------------------------------------------------ */

export const SCRAMBLE_TERM_MONTHS = 6;
/** Fração do capital devolvida por mês nos meses 1–5 (Grupo A, ~1/17). */
export const SCRAMBLE_MONTHLY_PRINCIPAL = 1 / 17;
export const SCRAMBLE_BASE_MONTHLY_RATE = 0.0075;
export const SCRAMBLE_GROUP_B_FIXED = 0.09;
const PAYMENT_DAY = 5;

const round2 = (n: number) => Math.round(n * 100) / 100;

function addMonthsKey(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Dia de pagamento de um mês: dia 5, ou o dia útil seguinte se calhar ao fim de semana. */
export function paymentDateFor(monthKey: string): string {
  const d = new Date(`${monthKey}-${String(PAYMENT_DAY).padStart(2, "0")}T00:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Data de vencimento de uma ronda (pagamento do 6.º mês). */
export function maturityDateFor(roundKey: string): string {
  return paymentDateFor(addMonthsKey(roundKey, SCRAMBLE_TERM_MONTHS));
}

/* ------------------------------------------------------------------ */
/* Rondas e resumo da conta                                           */
/* ------------------------------------------------------------------ */

export type ScrambleGroup = "A" | "B";
export type RoundStatus = "active" | "matured" | "late";

export interface SchedulePayment {
  date: string;
  /** 1..6 */
  month: number;
  principal: number;
  interest: number;
  /** Já recebido (true) ou projetado (false). */
  paid: boolean;
}

export interface ScrambleRound {
  roundKey: string;
  group: ScrambleGroup;
  investedOn: string;
  invested: number;
  principalRepaid: number;
  outstanding: number;
  interestReceived: number;
  /** Juros já corridos e ainda por receber (estimativa). */
  interestAccrued: number;
  /** Juros totais esperados até ao vencimento (recebidos + por receber, estimativa). */
  interestExpected: number;
  paymentsMade: number;
  maturityDate: string;
  status: RoundStatus;
  schedule: SchedulePayment[];
}

export interface ScrambleSummary {
  rounds: ScrambleRound[];
  activeRounds: number;
  /** Capital em dívida (investido e ainda não reembolsado). */
  outstanding: number;
  /** Último saldo de caixa conhecido (inclui bónus por investir). */
  cash: number;
  /** Saldo total como na Scramble: capital em dívida + caixa. */
  totalValue: number;
  deposits: number;
  withdrawals: number;
  netDeposits: number;
  investedTotal: number;
  interestReceived: number;
  interestAccrued: number;
  bonusReceived: number;
  fees: number;
  /** Ganho = juros recebidos + bónus − comissões (não inclui juros por receber). */
  gain: number;
  /** Taxa mensal efetiva usada nas estimativas (calibrada nas rondas vencidas). */
  monthlyRate: number;
  monthlyRateSource: "history" | "default";
  /** Rendibilidade anualizada do dinheiro depositado (XIRR, %), com juros corridos. */
  xirrPct: number | null;
  interestByMonth: Array<{ key: string; amount: number }>;
  interestByYear: Array<{ year: string; interest: number; bonus: number }>;
  /** Próximos pagamentos projetados (capital + juros), por data. */
  upcoming: Array<{ date: string; principal: number; interest: number; rounds: string[] }>;
  lastMovement: string | null;
}

interface RoundAcc {
  key: string;
  investedOn: string | null;
  invested: number;
  repayments: Array<{ date: string; amount: number }>;
  interest: number;
}

function buildRoundAccs(rows: ScrambleRoundRow[]): RoundAcc[] {
  const map = new Map<string, RoundAcc>();
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  for (const r of sorted) {
    const acc = map.get(r.roundKey) ?? {
      key: r.roundKey,
      investedOn: null,
      invested: 0,
      repayments: [],
      interest: 0,
    };
    if (r.invested > 0) {
      acc.invested += r.invested;
      acc.investedOn ??= r.date;
    }
    if (r.principalRepaid > 0) {
      const last = acc.repayments[acc.repayments.length - 1];
      if (last && last.date === r.date) last.amount += r.principalRepaid;
      else acc.repayments.push({ date: r.date, amount: r.principalRepaid });
    }
    acc.interest += r.interestReceived;
    map.set(r.roundKey, acc);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Capital em dívida no início de cada mês de pagamento já ocorrido. */
function outstandingBeforePayments(acc: RoundAcc): number[] {
  const out: number[] = [];
  let o = acc.invested;
  for (const p of acc.repayments) {
    out.push(o);
    o -= p.amount;
  }
  return out;
}

/**
 * Taxa mensal efetiva a partir das rondas Grupo A já vencidas:
 * juros pagos ÷ Σ capital em dívida de cada mês. Reflete a taxa base,
 * a taxa aumentada e os juros de prolongamento que a Scramble paga de facto.
 */
export function calibrateMonthlyRate(rows: ScrambleRoundRow[]): number | null {
  let interest = 0;
  let base = 0;
  for (const acc of buildRoundAccs(rows)) {
    const repaid = acc.repayments.reduce((s, p) => s + p.amount, 0);
    if (acc.invested <= 0 || acc.interest <= 0 || acc.invested - repaid > 0.01) continue;
    interest += acc.interest;
    base += outstandingBeforePayments(acc).reduce((s, v) => s + v, 0);
  }
  if (base <= 0 || interest <= 0) return null;
  const rate = interest / base;
  // Valores fora do plausível (0,5%–2%/mês) indicam dados incompletos.
  return rate >= 0.005 && rate <= 0.02 ? rate : null;
}

function buildRound(
  acc: RoundAcc,
  group: ScrambleGroup,
  rate: number,
  today: string,
): ScrambleRound {
  const maturityDate = maturityDateFor(acc.key);
  const repaid = acc.repayments.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, round2(acc.invested - repaid));
  const before = outstandingBeforePayments(acc);
  const paymentsMade = acc.repayments.length;
  const matured = outstanding <= 0.01;

  // Calendário: meses pagos com os valores reais; os restantes projetados.
  const schedule: SchedulePayment[] = acc.repayments.map((p, i) => ({
    date: p.date,
    month: i + 1,
    principal: round2(p.amount),
    interest: 0,
    paid: true,
  }));
  let interestExpected = acc.interest;
  let interestAccrued = 0;

  if (!matured) {
    const remainingMonths = Math.max(1, SCRAMBLE_TERM_MONTHS - paymentsMade);
    // Ritmo de amortização observado nesta ronda (ou ~1/17 por omissão).
    const observedShare =
      paymentsMade > 0 && acc.invested > 0 ? repaid / paymentsMade / acc.invested : null;
    const share =
      observedShare && observedShare > 0 && observedShare < 0.2
        ? observedShare
        : SCRAMBLE_MONTHLY_PRINCIPAL;

    let o = outstanding;
    const projectedOutstanding: number[] = [];
    for (let k = 1; k <= remainingMonths; k++) {
      const month = paymentsMade + k;
      const last = month >= SCRAMBLE_TERM_MONTHS;
      projectedOutstanding.push(o);
      const principal =
        group === "B" ? (last ? o : 0) : last ? o : Math.min(o, round2(acc.invested * share));
      schedule.push({
        date: paymentDateFor(addMonthsKey(acc.key, month)),
        month,
        principal: round2(principal),
        interest: 0,
        paid: false,
      });
      o = round2(o - principal);
    }

    if (group === "B") {
      interestExpected = round2(acc.invested * SCRAMBLE_GROUP_B_FIXED);
      const elapsed = Math.min(paymentsMade, SCRAMBLE_TERM_MONTHS) || elapsedMonths(acc, today);
      interestAccrued = round2((interestExpected * elapsed) / SCRAMBLE_TERM_MONTHS);
    } else {
      const months = [...before, ...projectedOutstanding];
      interestExpected = round2(months.reduce((s, v) => s + v, 0) * rate);
      interestAccrued = round2(before.reduce((s, v) => s + v, 0) * rate);
    }
    // Os juros são pagos todos no vencimento.
    const final = schedule[schedule.length - 1];
    if (final) final.interest = round2(interestExpected - acc.interest);
  } else if (schedule.length > 0) {
    schedule[schedule.length - 1]!.interest = round2(acc.interest);
  }

  const late = !matured && today > addDaysISOLocal(maturityDate, 10);
  return {
    roundKey: acc.key,
    group,
    investedOn: acc.investedOn ?? `${acc.key}-01`,
    invested: round2(acc.invested),
    principalRepaid: round2(repaid),
    outstanding,
    interestReceived: round2(acc.interest),
    interestAccrued: matured ? 0 : interestAccrued,
    interestExpected: round2(interestExpected),
    paymentsMade,
    maturityDate,
    status: matured ? "matured" : late ? "late" : "active",
    schedule,
  };
}

/** Meses de pagamento já decorridos desde a ronda (para o Grupo B, sem reembolsos). */
function elapsedMonths(acc: RoundAcc, today: string): number {
  let n = 0;
  for (let m = 1; m <= SCRAMBLE_TERM_MONTHS; m++) {
    if (paymentDateFor(addMonthsKey(acc.key, m)) <= today) n = m;
  }
  return n;
}

function addDaysISOLocal(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const INTEREST_TYPES = new Set<ScrambleCashType>(["interest", "interest_increased"]);
const BONUS_TYPES = new Set<ScrambleCashType>(["bonus_noncash", "bonus_cash"]);

export function isScrambleInterest(t: ScrambleCashType): boolean {
  return INTEREST_TYPES.has(t);
}
export function isScrambleBonus(t: ScrambleCashType): boolean {
  return BONUS_TYPES.has(t);
}

export function scrambleSummary(input: {
  cash: ScrambleCashRow[];
  rounds: ScrambleRoundRow[];
  group?: ScrambleGroup;
  today: string;
}): ScrambleSummary {
  const { today } = input;
  const group = input.group ?? "A";
  const calibrated = calibrateMonthlyRate(input.rounds);
  const monthlyRate = calibrated ?? SCRAMBLE_BASE_MONTHLY_RATE;

  const rounds = buildRoundAccs(input.rounds).map((acc) =>
    buildRound(acc, group, monthlyRate, today),
  );

  const cash = [...input.cash].sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  const sumOf = (pred: (r: ScrambleCashRow) => boolean) =>
    round2(cash.filter(pred).reduce((s, r) => s + r.amount, 0));

  const deposits = sumOf((r) => r.type === "deposit");
  const withdrawals = Math.abs(sumOf((r) => r.type === "withdrawal"));
  const interestReceived = sumOf((r) => INTEREST_TYPES.has(r.type));
  const bonusReceived = sumOf((r) => BONUS_TYPES.has(r.type));
  const fees = Math.abs(sumOf((r) => r.type === "fee"));
  const lastWithBalance = [...cash].reverse().find((r) => r.balance != null);
  const cashBalance = round2(lastWithBalance?.balance ?? 0);

  // As linhas por ronda vêm arredondadas ao cêntimo; o "Capital final" da linha
  // mais recente é o total exato da Scramble.
  const lastRoundRow = [...input.rounds]
    .sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq)
    .pop();
  const outstanding = round2(
    lastRoundRow?.closingPrincipal ?? rounds.reduce((s, r) => s + r.outstanding, 0),
  );
  const interestAccrued = round2(rounds.reduce((s, r) => s + r.interestAccrued, 0));
  const totalValue = round2(outstanding + cashBalance);

  const monthMap = new Map<string, number>();
  const yearMap = new Map<string, { interest: number; bonus: number }>();
  for (const r of cash) {
    if (INTEREST_TYPES.has(r.type)) {
      const k = r.date.slice(0, 7);
      monthMap.set(k, (monthMap.get(k) ?? 0) + r.amount);
    }
    if (INTEREST_TYPES.has(r.type) || BONUS_TYPES.has(r.type)) {
      const y = r.date.slice(0, 4);
      const cur = yearMap.get(y) ?? { interest: 0, bonus: 0 };
      if (INTEREST_TYPES.has(r.type)) cur.interest += r.amount;
      else cur.bonus += r.amount;
      yearMap.set(y, cur);
    }
  }

  // XIRR do dinheiro depositado: depósitos saem, levantamentos entram, e no fim
  // "recebe-se" o saldo total mais os juros já corridos.
  const flows: CashFlow[] = cash
    .filter((r) => r.type === "deposit" || r.type === "withdrawal")
    .map((r) => ({ date: r.date, amount: -r.amount }));
  if (totalValue + interestAccrued > 0) {
    flows.push({ date: today, amount: totalValue + interestAccrued });
  }
  const firstFlow = flows.reduce<string | null>(
    (min, f) => (min == null || f.date < min ? f.date : min),
    null,
  );
  // Abaixo de ~3 meses a anualização exagera tudo.
  const longEnough = firstFlow != null && daysBetween(firstFlow, today) >= 90;
  const x = longEnough ? xirr(flows) : null;

  const upcomingMap = new Map<
    string,
    { date: string; principal: number; interest: number; rounds: string[] }
  >();
  for (const r of rounds) {
    for (const p of r.schedule) {
      if (p.paid || p.date < today) continue;
      const cur = upcomingMap.get(p.date) ?? {
        date: p.date,
        principal: 0,
        interest: 0,
        rounds: [],
      };
      cur.principal = round2(cur.principal + p.principal);
      cur.interest = round2(cur.interest + p.interest);
      cur.rounds.push(r.roundKey);
      upcomingMap.set(p.date, cur);
    }
  }

  return {
    rounds,
    activeRounds: rounds.filter((r) => r.status !== "matured").length,
    outstanding,
    cash: cashBalance,
    totalValue,
    deposits,
    withdrawals,
    netDeposits: round2(deposits - withdrawals),
    investedTotal: round2(rounds.reduce((s, r) => s + r.invested, 0)),
    interestReceived,
    interestAccrued,
    bonusReceived,
    fees,
    gain: round2(interestReceived + bonusReceived - fees),
    monthlyRate,
    monthlyRateSource: calibrated != null ? "history" : "default",
    xirrPct: x?.annualizedPct ?? null,
    interestByMonth: [...monthMap.entries()]
      .map(([key, amount]) => ({ key, amount: round2(amount) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    interestByYear: [...yearMap.entries()]
      .map(([year, v]) => ({ year, interest: round2(v.interest), bonus: round2(v.bonus) }))
      .sort((a, b) => a.year.localeCompare(b.year)),
    upcoming: [...upcomingMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    lastMovement:
      [...cash.map((c) => c.date), ...input.rounds.map((r) => r.date)].sort().pop() ?? null,
  };
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/* ------------------------------------------------------------------ */
/* Importação (substituição por período)                               */
/* ------------------------------------------------------------------ */

/**
 * Os extratos são instantâneos completos de um período: importar substitui
 * todos os movimentos desse tipo dentro do período do ficheiro. Repetir a
 * importação (ou importar um período sobreposto) nunca duplica movimentos.
 */
export interface ScrambleImportPlan {
  kind: ScrambleReportKind;
  period: { from: string; to: string };
  rows: number;
  /** Movimentos já guardados no período que vão ser substituídos. */
  replaced: number;
  summary: {
    deposits: number;
    interest: number;
    bonus: number;
    principal: number;
    invested: number;
    rounds: string[];
  };
}

export function planScrambleImport(
  parsed: ScrambleParseResult,
  existingInPeriod: number,
): ScrambleImportPlan | null {
  if (!parsed.period || parsed.errors.length > 0) return null;
  const c = parsed.cash;
  const r = parsed.rounds;
  const sum = (xs: number[]) => round2(xs.reduce((s, v) => s + v, 0));
  return {
    kind: parsed.kind,
    period: parsed.period,
    rows: parsed.kind === "cash" ? c.length : r.length,
    replaced: existingInPeriod,
    summary: {
      deposits: sum(c.filter((x) => x.type === "deposit").map((x) => x.amount)),
      interest:
        parsed.kind === "cash"
          ? sum(c.filter((x) => INTEREST_TYPES.has(x.type)).map((x) => x.amount))
          : sum(r.map((x) => x.interestReceived)),
      bonus: sum(c.filter((x) => BONUS_TYPES.has(x.type)).map((x) => x.amount)),
      principal:
        parsed.kind === "cash"
          ? sum(c.filter((x) => x.type === "principal").map((x) => x.amount))
          : sum(r.map((x) => x.principalRepaid)),
      invested: sum(r.map((x) => x.invested)),
      rounds: [...new Set(r.map((x) => x.roundKey))].sort(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Rendimento passivo (dashboard)                                      */
/* ------------------------------------------------------------------ */

/**
 * Juros recebidos como registos de rendimento (formato dos dividendos) e
 * juros previstos no vencimento de cada ronda, para o cartão de rendimento
 * passivo. Os bónus ficam de fora: não são rendimento recorrente.
 */
export function scramblePassiveIncome(
  data: {
    asset: { id: string; name: string };
    summary: Pick<ScrambleSummary, "rounds">;
    cash: Array<Pick<ScrambleCashRow, "date" | "type" | "amount">>;
  } | null,
  today: string,
): { records: DividendRecord[]; upcoming: ProjectedDividend[] } {
  if (!data) return { records: [], upcoming: [] };
  const { asset } = data;
  const records: DividendRecord[] = data.cash
    .filter((r) => INTEREST_TYPES.has(r.type) && r.amount > 0)
    .map((r) => ({
      asset_id: asset.id,
      asset_name: asset.name,
      amount: r.amount,
      gross_amount: r.amount,
      net_amount: r.amount,
      currency: "EUR",
      paid_at: r.date,
      payment_date: r.date,
      status: "received",
    }));
  const upcoming: ProjectedDividend[] = [];
  for (const round of data.summary.rounds) {
    for (const p of round.schedule) {
      if (p.paid || p.interest <= 0 || p.date < today) continue;
      upcoming.push({
        assetId: asset.id,
        assetName: `${asset.name} · juros`,
        exDate: p.date,
        paymentDate: p.date,
        perShareNative: 0,
        currency: "EUR",
        quantity: 0,
        gross: p.interest,
        tax: 0,
        net: p.interest,
      });
    }
  }
  return { records, upcoming };
}
