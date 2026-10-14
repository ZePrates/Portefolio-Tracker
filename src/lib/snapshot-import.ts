/**
 * Importação de histórico mensal (ex.: folha de Excel própria) para as
 * fotografias da carteira. Formato CSV: data;investido;valor
 * — data em AAAA-MM-DD ou DD/MM/AAAA, números em formato PT ou EN,
 * separador ";" ou "," (com "," só quando os números não usam vírgula).
 */

import { parseNumberPt } from "@/lib/format";

export interface HistoryRow {
  date: string;
  invested: number;
  value: number;
}

export interface HistoryParse {
  rows: HistoryRow[];
  errors: string[];
}

function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return valid(`${m[1]}-${m[2]}-${m[3]}`);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return valid(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
  return null;
}

function valid(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function parseHistoryCsv(text: string, today: string): HistoryParse {
  const rows = new Map<string, HistoryRow>();
  const errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = (line.includes(";") ? line.split(";") : line.split(",")).map((c) =>
      c.trim().replace(/^"|"$/g, ""),
    );
    const date = parseDate(cells[0] ?? "");
    if (!date) {
      // Cabeçalho (primeira linha não-data) é ignorado em silêncio.
      if (rows.size > 0 || errors.length > 0 || /\d/.test(cells[0] ?? ""))
        errors.push(`Linha ${i + 1}: data inválida "${cells[0] ?? ""}".`);
      return;
    }
    const invested = parseNumberPt(cells[1] ?? "");
    const value = parseNumberPt(cells[2] ?? "");
    if (!(invested >= 0) || !(value >= 0)) {
      errors.push(`Linha ${i + 1}: investido e valor têm de ser números ≥ 0.`);
      return;
    }
    if (date > today) {
      errors.push(`Linha ${i + 1}: data no futuro (${date}).`);
      return;
    }
    rows.set(date, { date, invested, value });
  });
  return { rows: [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)), errors };
}
