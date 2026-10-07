/** Datas de calendário no fuso de Lisboa — o "hoje" do utilizador, não o de UTC. */

export const APP_TIME_ZONE = "Europe/Lisbon";

const isoDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Data (YYYY-MM-DD) de um instante no fuso de Lisboa. */
export function isoDateLisbon(date: Date): string {
  return isoDayFormatter.format(date);
}

/**
 * Hoje (YYYY-MM-DD) em Lisboa. Com `toISOString()` (UTC), entre as 00:00 e
 * as 01:00 da hora de verão o "hoje" ainda seria ontem.
 */
export function todayLisbon(now: Date = new Date()): string {
  return isoDateLisbon(now);
}

/** Soma dias a uma data YYYY-MM-DD (aritmética de calendário, sem fuso). */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Valida uma data de calendário YYYY-MM-DD real (rejeita 2026-02-30). */
export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
