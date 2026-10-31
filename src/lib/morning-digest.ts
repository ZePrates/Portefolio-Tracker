/**
 * Resumo das 9h — lógica pura (sem I/O, sem LLM).
 *
 * Regras simples e verificáveis: variação do último fecho de cada ativo (em
 * moeda local) aplicada ao valor em EUR, quedas a partir de 5 %, ativos que
 * passaram para baixo do preço médio, agenda de dividendos e avisos de dados.
 * Os valores em euros não entram na notificação (aparece no ecrã bloqueado).
 */
import { addDaysISO, APP_TIME_ZONE } from "@/lib/dates";
import { formatDatePt, formatPercent } from "@/lib/format";

/** Queda diária (fração) a partir da qual um ativo é destacado. */
export const DROP_ALERT_THRESHOLD = 0.05;
/** Hora (Lisboa) a partir da qual o resumo pode ser enviado. */
export const DIGEST_HOUR = 9;
/** Depois desta hora já não se envia (um agendamento muito atrasado não acorda ninguém à tarde). */
export const DIGEST_LAST_HOUR = 12;
/** Dias sem preço a partir dos quais se avisa que a cotação está desatualizada. */
export const STALE_PRICE_DAYS = 4;

const WEEKDAYS_PT = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

export interface LisbonClock {
  date: string;
  hour: number;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
}

export function lisbonClock(now: Date): LisbonClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    date,
    hour: Number(get("hour")),
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
  };
}

/**
 * O agendamento corre às 08:00 e às 09:00 UTC (Lisboa muda de hora): só envia
 * em dias úteis, entre as 9h e as 12h de Lisboa. O registo de envios garante
 * um único resumo por dia.
 */
export function shouldSendDigest(clock: LisbonClock): { send: boolean; reason?: string } {
  if (clock.weekday === 0 || clock.weekday === 6) return { send: false, reason: "fim de semana" };
  if (clock.hour < DIGEST_HOUR) return { send: false, reason: `ainda não são ${DIGEST_HOUR}h` };
  if (clock.hour >= DIGEST_LAST_HOUR) return { send: false, reason: "fora da janela da manhã" };
  return { send: true };
}

export interface ClosePoint {
  date: string;
  value: number;
}

export interface SessionChange {
  date: string;
  previous: number;
  close: number;
  /** Fração (−0,05 = −5 %). */
  change: number;
}

/** Variação do último fecho completo: ignora a sessão de hoje (ainda a decorrer). */
export function lastSessionChange(points: ClosePoint[], today: string): SessionChange | null {
  const done = points
    .filter((p) => p.date < today && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (done.length < 2) return null;
  const prev = done[done.length - 2]!;
  const last = done[done.length - 1]!;
  return {
    date: last.date,
    previous: prev.value,
    close: last.value,
    change: last.value / prev.value - 1,
  };
}

export interface DigestPosition {
  name: string;
  ticker: string | null;
  /** Valor atual em EUR (último preço guardado). */
  valueEUR: number;
  /** Preço atual por unidade em EUR. */
  priceEUR: number;
  /** Preço médio de compra por unidade em EUR (0 = desconhecido). */
  averagePriceEUR: number;
  session: SessionChange | null;
  priceUpdatedAt: string | null;
}

export interface DigestDividendEvent {
  assetName: string;
  exDate: string | null;
  paymentDate: string | null;
  received: boolean;
}

export interface DigestInput {
  today: string;
  positions: DigestPosition[];
  dividends: DigestDividendEvent[];
  /** Data da última fotografia diária (null = nenhuma). */
  lastSnapshotDate: string | null;
}

export interface DigestMover {
  name: string;
  change: number;
  crossedBelowAverage: boolean;
}

export interface MorningDigest {
  today: string;
  sessionDate: string | null;
  /** Variação da parte cotada da carteira no último fecho (fração), ou null sem dados. */
  portfolioChange: number | null;
  pricedPositions: number;
  drops: DigestMover[];
  crossedBelowAverage: string[];
  topGainer: DigestMover | null;
  topLoser: DigestMover | null;
  exDividends: string[];
  payments: string[];
  warnings: string[];
}

const shortName = (p: { name: string; ticker: string | null }) =>
  (p.ticker?.trim() || p.name).replace(/\.(US|UK|NL|DE)$/i, "");

export function buildMorningDigest(input: DigestInput): MorningDigest {
  const priced = input.positions.filter((p) => p.session && p.valueEUR > 0);
  let changeEUR = 0;
  let baseEUR = 0;
  for (const p of priced) {
    const c = p.session!.change;
    const prevValue = p.valueEUR / (1 + c);
    changeEUR += p.valueEUR - prevValue;
    baseEUR += prevValue;
  }

  const movers: DigestMover[] = priced.map((p) => {
    const c = p.session!.change;
    const avg = p.averagePriceEUR;
    const prevPrice = p.priceEUR / (1 + c);
    return {
      name: shortName(p),
      change: c,
      crossedBelowAverage: avg > 0 && prevPrice >= avg && p.priceEUR < avg,
    };
  });

  const drops = movers
    .filter((m) => m.change <= -DROP_ALERT_THRESHOLD)
    .sort((a, b) => a.change - b.change);
  const byChange = [...movers].sort((a, b) => b.change - a.change);
  const topGainer = byChange[0] && byChange[0].change > 0 ? byChange[0] : null;
  const last = byChange[byChange.length - 1];
  const topLoser = last && last.change < 0 ? last : null;

  const sessionDates = priced.map((p) => p.session!.date).sort();
  const sessionDate = sessionDates[sessionDates.length - 1] ?? null;

  const horizon = addDaysISO(input.today, 2);
  const inWindow = (d: string | null) => !!d && d >= input.today && d <= horizon;
  const uniq = (xs: string[]) => [...new Set(xs)];
  const exDividends = uniq(
    input.dividends
      .filter((d) => inWindow(d.exDate))
      .map((d) => labelOn(d.assetName, d.exDate!, input.today)),
  );
  const payments = uniq(
    input.dividends
      .filter((d) => !d.received && inWindow(d.paymentDate))
      .map((d) => labelOn(d.assetName, d.paymentDate!, input.today)),
  );

  const warnings: string[] = [];
  const staleLimit = addDaysISO(input.today, -STALE_PRICE_DAYS);
  const stale = input.positions.filter(
    (p) => !p.priceUpdatedAt || p.priceUpdatedAt.slice(0, 10) < staleLimit,
  ).length;
  if (stale > 0) warnings.push(`${stale} ${stale === 1 ? "ativo" : "ativos"} sem preço atualizado`);
  if (!input.lastSnapshotDate || input.lastSnapshotDate < addDaysISO(input.today, -1)) {
    warnings.push("a fotografia diária de ontem não correu");
  }

  return {
    today: input.today,
    sessionDate,
    portfolioChange: baseEUR > 0 ? changeEUR / baseEUR : null,
    pricedPositions: priced.length,
    drops,
    crossedBelowAverage: movers.filter((m) => m.crossedBelowAverage).map((m) => m.name),
    topGainer,
    topLoser,
    exDividends,
    payments,
    warnings,
  };
}

function labelOn(name: string, date: string, today: string): string {
  if (date === today) return `${name} (hoje)`;
  if (date === addDaysISO(today, 1)) return `${name} (amanhã)`;
  return `${name} (${weekdayPt(date)})`;
}

export function weekdayPt(date: string): string {
  return WEEKDAYS_PT[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? "";
}

/** "+1,23 %" com o sinal de menos tipográfico. */
const pct = (fraction: number) => formatPercent(fraction * 100).replace("-", "−");

export interface DigestNotification {
  title: string;
  body: string;
  /** Destaque para o Android agrupar/substituir notificações do mesmo dia. */
  tag: string;
  url: string;
}

export function digestNotification(d: MorningDigest): DigestNotification {
  const lines: string[] = [];
  if (d.portfolioChange != null && d.sessionDate) {
    lines.push(`Último fecho (${weekdayPt(d.sessionDate)}): ${pct(d.portfolioChange)}`);
  } else {
    lines.push("Sem variações do último fecho.");
  }
  if (d.drops.length) {
    const shown = d.drops.slice(0, 4).map((m) => `${m.name} ${pct(m.change)}`);
    const more = d.drops.length > 4 ? ` e mais ${d.drops.length - 4}` : "";
    lines.push(
      `↓ Quedas ≥ ${Math.round(DROP_ALERT_THRESHOLD * 100)} %: ${shown.join(", ")}${more}`,
    );
  } else if (d.topLoser) {
    lines.push(`Maior queda: ${d.topLoser.name} ${pct(d.topLoser.change)}`);
  }
  if (d.topGainer) lines.push(`Maior subida: ${d.topGainer.name} ${pct(d.topGainer.change)}`);
  if (d.crossedBelowAverage.length) {
    lines.push(`Abaixo do preço médio: ${d.crossedBelowAverage.slice(0, 4).join(", ")}`);
  }
  if (d.exDividends.length) lines.push(`Ex-dividendo: ${d.exDividends.slice(0, 4).join(", ")}`);
  if (d.payments.length) lines.push(`Pagamentos: ${d.payments.slice(0, 4).join(", ")}`);
  if (d.warnings.length) lines.push(`⚠ ${d.warnings.join("; ")}`);

  const [, , m, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.today) ?? [];
  return {
    title: `Portefólio · ${weekdayPt(d.today)} ${Number(day)}/${m}`,
    body: lines.join("\n"),
    tag: `morning-digest-${d.today}`,
    url: d.drops.length ? "/performance" : "/",
  };
}

/** Texto curto para registo/diagnóstico (sem valores em euros). */
export function digestSummaryLine(d: MorningDigest): string {
  return `${formatDatePt(d.today)} · ${d.pricedPositions} ativos · quedas: ${d.drops.length}`;
}
