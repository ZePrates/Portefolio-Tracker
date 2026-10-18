/**
 * Fecho do mês — lógica pura. Cada passo da rotina mensal (extrato XTB,
 * compra da Elementum, relatório da Scramble e dividendos) é dado como feito
 * a partir dos próprios dados. Exceção: Elementum e Scramble não têm extrato
 * para comparar (uma segunda compra pode vir a seguir à primeira), por isso
 * só ficam feitos quando o utilizador confirma que está tudo registado.
 */

import type { DataQualityAlert } from "@/lib/data-quality";

export type MonthCloseKey = "xtb" | "dividends" | "elementum" | "scramble";

/** Passos que só o utilizador pode dar como completos. */
export const CONFIRMABLE_STEPS: readonly MonthCloseKey[] = ["elementum", "scramble"];

export interface MonthCloseStep {
  key: MonthCloseKey;
  title: string;
  done: boolean;
  /** Estado numa frase. */
  summary: string;
  /** O que falta, um por linha (movimentos por conciliar, dividendos por confirmar…). */
  pending: string[];
  /** Página onde se resolve. */
  href: "/importar" | "/dividendos" | "/metais" | "/p2p";
  action: string;
  /** O passo só fica feito quando o utilizador confirma que está tudo registado. */
  confirmable?: boolean;
  confirmed?: boolean;
}

export interface MonthClose {
  month: string;
  steps: MonthCloseStep[];
  doneCount: number;
  /** Dividendos líquidos recebidos no mês (EUR). */
  dividendsNet: number;
  /** Já estamos nos últimos dias do mês (ou depois dele). */
  windowOpen: boolean;
}

export interface MonthCloseInput {
  /** "YYYY-MM". */
  month: string;
  today: string;
  /** Passos confirmados pelo utilizador neste mês. */
  confirmed?: readonly MonthCloseKey[];
  assets: Array<{ id: string; name: string; ticker: string | null; class: string }>;
  transactions: Array<{
    asset_id: string;
    type: string;
    traded_at: string;
    source: string | null;
    fee: number | null;
  }>;
  dividends: Array<{
    asset_id: string | null;
    asset_name: string | null;
    payment_date: string | null;
    paid_at: string | null;
    source: string | null;
    payment_date_estimated: boolean | null;
    net_amount: number | null;
    amount: number | null;
  }>;
  p2pMovements: Array<{ occurred_on: string; type: string }>;
}

/** Classes guardadas na XTB (o resto tem plataforma própria). */
const XTB_CLASSES = new Set(["etf", "reit", "acao_dividendo", "acao_crescimento"]);

const inMonth = (date: string | null | undefined, month: string) =>
  !!date && date.slice(0, 7) === month;

const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Dias do início do mês seguinte em que ainda se fecha o mês anterior. */
const CLOSE_GRACE_DAYS = 10;
/** O lembrete de fecho começa nos últimos 3 dias do mês. */
const CLOSE_REMINDER_DAYS = 3;

/** Mês a fechar por defeito: o anterior nos primeiros dias, depois o atual. */
export function defaultCloseMonth(today: string, graceDays = CLOSE_GRACE_DAYS): string {
  const day = Number(today.slice(8, 10));
  return day <= graceDays ? shiftMonth(today.slice(0, 7), -1) : today.slice(0, 7);
}

/** Guarda a confirmação de um passo (em `dismissed_alerts`, por mês). */
export const confirmKey = (month: string, step: MonthCloseKey) => `month-close:${month}:${step}`;

/** Últimos 3 dias do mês, ou qualquer data depois dele. */
export function closeWindowOpen(month: string, today: string): boolean {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstReminder = String(lastDay - (CLOSE_REMINDER_DAYS - 1)).padStart(2, "0");
  return today >= `${month}-${firstReminder}`;
}

/** Mês de que o dashboard deve lembrar o fecho hoje (ou null fora da janela). */
export function closeReminderMonth(today: string): string | null {
  const current = today.slice(0, 7);
  if (Number(today.slice(8, 10)) <= CLOSE_GRACE_DAYS) return shiftMonth(current, -1);
  return closeWindowOpen(current, today) ? current : null;
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Aviso do dashboard: fecho do mês por completar (mensagem estável, dispensa-se por mês). */
export function monthCloseAlert(close: MonthClose): DataQualityAlert | null {
  const total = close.steps.length;
  if (total === 0 || close.doneCount === total) return null;
  const name = MONTH_NAMES[Number(close.month.slice(5, 7)) - 1];
  return {
    code: "month_close_due",
    severity: "warning",
    count: total - close.doneCount,
    href: "/fecho",
    message: `Fecho de ${name} de ${close.month.slice(0, 4)}: ainda faltam passos. Abre o Fecho do mês.`,
  };
}

/** "2026-01" + (-1) → "2025-12". */
export function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}

export function monthClose(input: MonthCloseInput): MonthClose {
  const { month, today } = input;
  const assetById = new Map(input.assets.map((a) => [a.id, a]));
  const label = (id: string | null, fallback?: string | null) => {
    const a = id ? assetById.get(id) : undefined;
    return a?.ticker || a?.name || fallback || "Ativo";
  };
  const hasClass = (pred: (c: string) => boolean) => input.assets.some((a) => pred(a.class));
  const tx = input.transactions.filter((t) => inMonth(t.traded_at, month));
  const steps: MonthCloseStep[] = [];
  const windowOpen = closeWindowOpen(month, today);
  // Meses antigos, já fechados antes da confirmação existir, continuam a valer pelos dados.
  const needsConfirm = month >= shiftMonth(today.slice(0, 7), -1);
  /** Elementum e Scramble: um movimento no mês não prova que já está tudo registado. */
  const confirmable = (key: MonthCloseKey, found: number) => {
    const confirmed = input.confirmed?.includes(key) ?? false;
    const note = confirmed
      ? " Confirmado: está tudo registado."
      : windowOpen
        ? " Confirma quando estiver tudo registado."
        : " O mês ainda não acabou: confirma no fim, se não vier mais nada.";
    return {
      done: needsConfirm ? confirmed : found > 0,
      confirmable: needsConfirm,
      confirmed,
      note: needsConfirm ? note : "",
    };
  };

  // Dividendos já pagos no mês (a data de pagamento manda; senão, a de recebimento).
  const paid = input.dividends.filter((d) => {
    const date = d.payment_date ?? d.paid_at;
    return inMonth(date, month) && date! <= today;
  });

  if (hasClass((c) => XTB_CLASSES.has(c))) {
    const xtbTx = tx.filter((t) => XTB_CLASSES.has(assetById.get(t.asset_id)?.class ?? ""));
    const manual = xtbTx.filter((t) => t.source !== "xtb");
    const fromStatement =
      xtbTx.length - manual.length + paid.filter((d) => d.source === "xtb").length;
    steps.push({
      key: "xtb",
      title: "Importar o extrato da XTB",
      done: manual.length === 0 && fromStatement > 0,
      summary:
        manual.length > 0
          ? `${plural(manual.length, "movimento registado", "movimentos registados")} à mão por confirmar com o extrato.`
          : fromStatement > 0
            ? `${plural(fromStatement, "operação do mês já veio", "operações do mês já vieram")} do extrato.`
            : "Ainda nada deste mês veio do extrato.",
      pending: manual
        .sort((a, b) => a.traded_at.localeCompare(b.traded_at))
        .map(
          (t) =>
            `${label(t.asset_id)} · ${dayMonth(t.traded_at)} · ${t.type === "sell" ? "venda" : "compra"}`,
        ),
      href: "/importar",
      action: "Importar extrato",
    });
  }

  const unconfirmed = paid
    .filter((d) => d.source !== "xtb")
    .sort((a, b) =>
      (a.payment_date ?? a.paid_at ?? "").localeCompare(b.payment_date ?? b.paid_at ?? ""),
    );
  const dividendsNet = paid.reduce((s, d) => s + Number(d.net_amount ?? d.amount ?? 0), 0);
  if (paid.length > 0 || hasClass((c) => XTB_CLASSES.has(c))) {
    steps.push({
      key: "dividends",
      title: "Confirmar os dividendos",
      done: unconfirmed.length === 0,
      summary:
        unconfirmed.length > 0
          ? `${plural(unconfirmed.length, "dividendo pago continua estimado", "dividendos pagos continuam estimados")}: o extrato confirma o valor real.`
          : paid.length > 0
            ? `${plural(paid.length, "dividendo recebido e confirmado", "dividendos recebidos e confirmados")}.`
            : "Nenhum dividendo pago neste mês.",
      pending: unconfirmed.map(
        (d) =>
          `${label(d.asset_id, d.asset_name)} · ${dayMonth((d.payment_date ?? d.paid_at)!)}${d.payment_date_estimated ? " · data estimada" : ""}`,
      ),
      href: "/dividendos",
      action: "Ver dividendos",
    });
  }

  if (hasClass((c) => c === "metal")) {
    const buys = tx
      .filter((t) => assetById.get(t.asset_id)?.class === "metal" && t.type === "buy")
      .sort((a, b) => a.traded_at.localeCompare(b.traded_at));
    const c = confirmable("elementum", buys.length);
    steps.push({
      key: "elementum",
      title: "Registar as compras da Elementum",
      done: c.done,
      summary:
        (buys.length > 0
          ? `${buys.length === 1 ? "Compra registada" : `${buys.length} compras registadas`} a ${buys.map((b) => dayMonth(b.traded_at)).join(", ")}.`
          : "Sem compra registada neste mês.") + c.note,
      pending: [],
      href: "/metais",
      action: "Abrir metais",
      confirmable: c.confirmable,
      confirmed: c.confirmed,
    });
  }

  if (hasClass((c) => c === "p2p")) {
    const moves = input.p2pMovements
      .filter((m) => inMonth(m.occurred_on, month))
      .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
    const last = moves.at(-1);
    const c = confirmable("scramble", moves.length);
    steps.push({
      key: "scramble",
      title: "Importar o relatório da Scramble",
      done: c.done,
      summary:
        (last
          ? `${plural(moves.length, "movimento", "movimentos")} do mês, o último a ${dayMonth(last.occurred_on)}.`
          : "Sem movimentos da Scramble neste mês.") + c.note,
      pending: [],
      href: "/p2p",
      action: "Abrir P2P",
      confirmable: c.confirmable,
      confirmed: c.confirmed,
    });
  }

  return {
    month,
    steps,
    doneCount: steps.filter((s) => s.done).length,
    dividendsNet,
    windowOpen,
  };
}
