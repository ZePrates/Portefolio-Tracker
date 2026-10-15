/**
 * Fecho do mês — lógica pura. Cada passo da rotina mensal (extrato XTB,
 * compra da Elementum, relatório da Scramble e dividendos) é dado como feito
 * a partir dos próprios dados, sem caixas para marcar à mão.
 */

export type MonthCloseKey = "xtb" | "dividends" | "elementum" | "scramble";

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
}

export interface MonthClose {
  month: string;
  steps: MonthCloseStep[];
  doneCount: number;
  /** Dividendos líquidos recebidos no mês (EUR). */
  dividendsNet: number;
}

export interface MonthCloseInput {
  /** "YYYY-MM". */
  month: string;
  today: string;
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

/** Mês a fechar por defeito: o anterior nos primeiros dias, depois o atual. */
export function defaultCloseMonth(today: string, graceDays = 10): string {
  const day = Number(today.slice(8, 10));
  return day <= graceDays ? shiftMonth(today.slice(0, 7), -1) : today.slice(0, 7);
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
    steps.push({
      key: "elementum",
      title: "Registar a compra da Elementum",
      done: buys.length > 0,
      summary:
        buys.length > 0
          ? `${buys.length === 1 ? "Compra registada" : `${buys.length} compras registadas`} a ${buys.map((b) => dayMonth(b.traded_at)).join(", ")}.`
          : "Sem compra registada neste mês.",
      pending: [],
      href: "/metais",
      action: "Abrir metais",
    });
  }

  if (hasClass((c) => c === "p2p")) {
    const moves = input.p2pMovements
      .filter((m) => inMonth(m.occurred_on, month))
      .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
    const last = moves.at(-1);
    steps.push({
      key: "scramble",
      title: "Importar o relatório da Scramble",
      done: moves.length > 0,
      summary: last
        ? `${plural(moves.length, "movimento", "movimentos")} do mês, o último a ${dayMonth(last.occurred_on)}.`
        : "Sem movimentos da Scramble neste mês.",
      pending: [],
      href: "/p2p",
      action: "Abrir P2P",
    });
  }

  return {
    month,
    steps,
    doneCount: steps.filter((s) => s.done).length,
    dividendsNet,
  };
}
