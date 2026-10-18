import { formatDatePt } from "@/lib/format";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Calendar labels only; never resamples or changes the plotted series. */
export function formatChartMonth(key: string): string {
  const match = /^(\d{4})-(\d{2})(?:$|-)/.exec(key);
  if (!match) return key;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : key;
}

/** Monthly aggregates have no specific day: preserve their month rather than invent one. */
export function formatChartTooltipDate(key: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(key) ? formatDatePt(key) : formatChartMonth(key);
}

function monthIndex(key: string): number | null {
  const match = /^(\d{4})-(\d{2})(?:$|-)/.exec(key);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? Number(match[1]) * 12 + month - 1 : null;
}

/** One existing date per month, or every three months over a multi-year horizon. */
export function chartDateTicks(dates: readonly string[]): string[] {
  const months = new Map<number, string>();
  for (const date of dates) {
    const index = monthIndex(date);
    if (index !== null && !months.has(index)) months.set(index, date);
  }
  const sorted = [...months.entries()].sort(([a], [b]) => a - b);
  const first = sorted[0]?.[0];
  const last = sorted.at(-1)?.[0];
  if (first === undefined || last === undefined) return [];
  const step = last - first >= 24 ? 3 : 1;
  let previous = first - step;
  return sorted.flatMap(([index, date]) => {
    if (index - previous < step) return [];
    previous = index;
    return [date];
  });
}

/** Recharts can further omit labels to fit narrow charts without overlapping. */
export function dateXAxis(dates: readonly string[]) {
  return {
    ticks: chartDateTicks(dates),
    tickFormatter: formatChartMonth,
    interval: "preserveStart" as const,
    minTickGap: 24,
  };
}
