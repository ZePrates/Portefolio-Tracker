import type { Slice } from "@/lib/exposure-types";
import { countryNamePt, formatPct } from "@/lib/format";
import { compareValues, type SortDir, type SortValue } from "@/lib/table";

export function companyNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bclass\s+[abc]\b/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(inc|corp|corporation|plc|ag|sa|nv|se|ltd|co|holdings|limited|company)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function readableCompanyName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  const acronyms = new Set([
    "ASML",
    "SAP",
    "AMD",
    "IBM",
    "TSMC",
    "HSBC",
    "UBS",
    "BMW",
    "AT&T",
    "BP",
    "3M",
    "ABB",
    "SSE",
    "BHP",
  ]);
  return name
    .split(/\s+/)
    .map((word) => (acronyms.has(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(" ");
}

export const exposurePct = (value: number, hidden = false) =>
  formatPct(value, Math.abs(value) < 1 ? 2 : 1, hidden);

export function exposureEUR(value: number, hidden = false): string {
  if (hidden) return "••••";
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Math.abs(value) > 1000 ? 0 : 2,
    maximumFractionDigits: Math.abs(value) > 1000 ? 0 : 2,
  }).format(value);
}

const sectors: Record<string, string> = {
  technology: "Tecnologia",
  informationtechnology: "Tecnologia",
  finance: "Financeiro",
  financials: "Financeiro",
  financialservices: "Financeiro",
  financeiro: "Financeiro",
  healthcare: "Saúde",
  saude: "Saúde",
  industrials: "Indústria",
  industria: "Indústria",
  consumercyclical: "Consumo cíclico",
  consumercyclicals: "Consumo cíclico",
  consumerdiscretionary: "Consumo cíclico",
  consumodiscricionario: "Consumo cíclico",
  consumerdefensive: "Consumo não cíclico",
  consumernoncyclicals: "Consumo não cíclico",
  consumernoncyclical: "Consumo não cíclico",
  consumerstaples: "Consumo não cíclico",
  consumodefensivo: "Consumo não cíclico",
  consumobasico: "Consumo não cíclico",
  communicationservices: "Comunicações",
  comunicacoes: "Comunicações",
  nonenergymaterials: "Materiais",
  basicmaterials: "Materiais",
  materials: "Materiais",
  energy: "Energia",
  utilities: "Utilities",
  realestate: "Imobiliário",
  imobiliario: "Imobiliário",
  other: "Outros",
  others: "Outros",
  outros: "Outros",
  cash: "Liquidez e derivados",
  cashandderivatives: "Liquidez e derivados",
  cashandorderivatives: "Liquidez e derivados",
  futures: "Liquidez e derivados",
  fx: "Liquidez e derivados",
  derivatives: "Liquidez e derivados",
  liquidezedерivados: "Liquidez e derivados",
  moneymarket: "Liquidez e derivados",
};
export function exposureSector(raw: string): string {
  const key = raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return sectors[key] ?? raw;
}

export function exposureCountry(raw: string): string {
  const aliases: Record<string, string> = {
    us: "United States",
    usa: "United States",
    "united states of america": "United States",
    uk: "United Kingdom",
    "great britain": "United Kingdom",
    korea: "South Korea",
    "korea (south)": "South Korea",
    "korea, republic of": "South Korea",
    "czech republic": "Chéquia",
    czechia: "Chéquia",
    malaysia: "Malásia",
    philippines: "Filipinas",
    turkey: "Turquia",
    "united arab emirates": "Emirados Árabes Unidos",
    "new zealand": "Nova Zelândia",
    chile: "Chile",
    argentina: "Argentina",
    colombia: "Colômbia",
    peru: "Peru",
    hungary: "Hungria",
    greece: "Grécia",
    egypt: "Egito",
    russia: "Rússia",
    other: "Outros",
    others: "Outros",
    cash: "Liquidez e derivados",
    "cash and derivatives": "Liquidez e derivados",
  };
  return countryNamePt(aliases[raw.trim().toLowerCase()] ?? raw.trim());
}

export function mergeDisplaySlices(slices: Slice[], translate: (s: string) => string): Slice[] {
  const merged = new Map<string, Slice>();
  for (const slice of slices) {
    const value = translate(slice.value);
    const existing = merged.get(value);
    if (existing) {
      existing.amount += slice.amount;
      existing.pct += slice.pct;
      for (const contributor of slice.contributors) {
        const prior = existing.contributors.find((c) => c.assetId === contributor.assetId);
        if (prior) prior.amount += contributor.amount;
        else existing.contributors.push({ ...contributor });
      }
    } else
      merged.set(value, {
        ...slice,
        value,
        contributors: slice.contributors.map((c) => ({ ...c })),
      });
  }
  return [...merged.values()];
}

export function sortExposureRows<T>(
  rows: T[],
  value: (r: T) => SortValue,
  dir: SortDir,
  label: (r: T) => string,
): T[] {
  return [...rows].sort((a, b) => {
    const aOther = label(a).toLowerCase() === "outros";
    const bOther = label(b).toLowerCase() === "outros";
    return aOther !== bOther ? (aOther ? 1 : -1) : compareValues(value(a), value(b), dir);
  });
}

export interface ManagerSyncResult {
  ticker: string;
  ok: boolean;
  rows: number;
  weight_sum: number;
  as_of: string | null;
  error?: string;
  skipped?: boolean;
}
export function managerSyncSummary(results: ManagerSyncResult[]) {
  return {
    updated: results.filter((r) => r.ok && !r.skipped).length,
    unsupported: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
  };
}
