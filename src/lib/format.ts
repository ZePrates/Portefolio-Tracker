const eurFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

export function formatEUR(value: number, hidden = false): string {
  if (hidden) return "••••";
  return eurFormatter.format(value ?? 0);
}

export function formatPercent(value: number, hidden = false): string {
  if (hidden) return "••••";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value ?? 0).toFixed(2).replace(".", ",")} %`;
}

export function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
