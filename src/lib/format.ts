import { APP_TIME_ZONE } from "@/lib/dates";

const HIDDEN = "••••";
const EMPTY = "—";

/** Espaço inseparável: impede que "%" ou "€" fiquem sozinhos na linha seguinte. */
const NBSP = "\u00a0";

// O pt-PT só agrupa milhares a partir de 5 dígitos (1448,40 € vs 11 656,15 €);
// `useGrouping: true` (= "always") garante 1 448,40 € em todas as tabelas e cartões.
const GROUP = { useGrouping: true } as const;

const eurFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  ...GROUP,
});

const percentFormatter = new Intl.NumberFormat("pt-PT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  ...GROUP,
});

const compactFormatter = new Intl.NumberFormat("pt-PT", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatEUR(value: number, hidden = false): string {
  if (hidden) return HIDDEN;
  const v = value ?? 0;
  if (!Number.isFinite(v)) return EMPTY;
  return eurFormatter.format(v);
}

/** Formata um valor na moeda original do ativo (ex.: USD). */
export function formatMoney(value: number, currency = "EUR", hidden = false): string {
  if (hidden) return HIDDEN;
  const v = value ?? 0;
  if (!Number.isFinite(v)) return EMPTY;
  try {
    return new Intl.NumberFormat("pt-PT", { style: "currency", currency, ...GROUP }).format(v);
  } catch {
    return `${percentFormatter.format(v)} ${currency}`;
  }
}

export function formatPercent(value: number, hidden = false): string {
  if (hidden) return HIDDEN;
  const v = value ?? 0;
  if (!Number.isFinite(v)) return EMPTY;
  const sign = v > 0 ? "+" : "";
  return `${sign}${percentFormatter.format(v)}${NBSP}%`;
}

/** Número em pt-PT com milhares e casas decimais fixas ("1 234,50"). */
export function formatNumber(value: number, decimals = 2, hidden = false): string {
  if (hidden) return HIDDEN;
  if (!Number.isFinite(value)) return EMPTY;
  return new Intl.NumberFormat("pt-PT", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    ...GROUP,
  }).format(value);
}

/** Percentagem sem sinal ("62,1 %"). Para variações com sinal usa formatPercent. */
export function formatPct(value: number, decimals = 1, hidden = false): string {
  if (hidden) return HIDDEN;
  if (!Number.isFinite(value)) return EMPTY;
  return `${formatNumber(value, decimals)}${NBSP}%`;
}

/** Pontos percentuais com sinal ("+2,5 pp"). */
export function formatPp(value: number, decimals = 1, hidden = false): string {
  if (hidden) return HIDDEN;
  if (!Number.isFinite(value)) return EMPTY;
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, decimals)}${NBSP}pp`;
}

/** Quantidade de unidades sem zeros à direita ("0,5", "12 345,678"). */
export function formatQuantity(value: number, maxDecimals = 6, hidden = false): string {
  if (hidden) return HIDDEN;
  if (!Number.isFinite(value)) return EMPTY;
  return new Intl.NumberFormat("pt-PT", { maximumFractionDigits: maxDecimals, ...GROUP }).format(
    value,
  );
}

/** Valor abreviado para eixos de gráficos ("16 mil", "1,3 M"). */
export function formatCompact(value: number): string {
  return Number.isFinite(value) ? compactFormatter.format(value) : EMPTY;
}

/** Euros abreviados para eixos ("16 mil €"). */
export function formatEURCompact(value: number): string {
  return Number.isFinite(value) ? `${compactFormatter.format(value)}${NBSP}€` : EMPTY;
}

const MONTHS_PT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/** "2026-01" ou "2026-01-15" → "jan/26" (eixos de gráficos). */
export function formatMonthPt(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  if (!m) return EMPTY;
  const month = MONTHS_PT[Number(m[2]) - 1];
  return month ? `${month}/${m[1]!.slice(2)}` : EMPTY;
}

/** "2026-01-15" → "15/01" (eixos curtos). */
export function formatDayMonthPt(iso: string | null | undefined): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[1]}` : EMPTY;
}

/** Chave de período de gráficos ("2026", "2026-01", "2026-01-15") em PT-PT. */
export function formatPeriodKey(key: string, long = false): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return long ? formatDatePt(key) : formatDayMonthPt(key);
  if (/^\d{4}-\d{2}$/.test(key)) return formatMonthPt(key);
  return key;
}

const COUNTRIES_PT: Record<string, string> = {
  "united states": "Estados Unidos",
  usa: "Estados Unidos",
  "united kingdom": "Reino Unido",
  france: "França",
  germany: "Alemanha",
  japan: "Japão",
  china: "China",
  canada: "Canadá",
  switzerland: "Suíça",
  netherlands: "Países Baixos",
  ireland: "Irlanda",
  taiwan: "Taiwan",
  india: "Índia",
  australia: "Austrália",
  "south korea": "Coreia do Sul",
  denmark: "Dinamarca",
  spain: "Espanha",
  italy: "Itália",
  sweden: "Suécia",
  brazil: "Brasil",
  "hong kong": "Hong Kong",
  singapore: "Singapura",
  "saudi arabia": "Arábia Saudita",
  mexico: "México",
  belgium: "Bélgica",
  finland: "Finlândia",
  norway: "Noruega",
  luxembourg: "Luxemburgo",
  austria: "Áustria",
  israel: "Israel",
  "south africa": "África do Sul",
  indonesia: "Indonésia",
  thailand: "Tailândia",
  poland: "Polónia",
  portugal: "Portugal",
  other: "Outros",
  others: "Outros",
};

const SECTORS_PT: Record<string, string> = {
  technology: "Tecnologia",
  "information technology": "Tecnologia",
  financials: "Financeiro",
  finance: "Financeiro",
  "financial services": "Financeiro",
  healthcare: "Saúde",
  "health care": "Saúde",
  "consumer discretionary": "Consumo discricionário",
  "consumer cyclical": "Consumo discricionário",
  "consumer staples": "Consumo básico",
  "consumer defensive": "Consumo básico",
  industrials: "Indústria",
  energy: "Energia",
  utilities: "Serviços públicos",
  "real estate": "Imobiliário",
  materials: "Materiais",
  "basic materials": "Materiais",
  "communication services": "Comunicações",
  other: "Outros",
  others: "Outros",
};

const lookupPt = (map: Record<string, string>, name: string): string =>
  map[name.trim().toLowerCase()] ?? name;

/** Nome de país em PT-PT (nomes desconhecidos ficam como vieram da fonte). */
export function countryNamePt(name: string): string {
  return lookupPt(COUNTRIES_PT, name);
}

/** Nome de setor em PT-PT (nomes desconhecidos ficam como vieram da fonte). */
export function sectorNamePt(name: string): string {
  return lookupPt(SECTORS_PT, name);
}

const dateFormatter = new Intl.DateTimeFormat("pt-PT", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Data em dd/mm/aaaa. Datas simples (YYYY-MM-DD) não sofrem desvio de fuso. */
export function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return dateFormatter.format(d);
}

const dayLongFormatter = new Intl.DateTimeFormat("pt-PT", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Dia por extenso, ex.: "quarta-feira, 8 de outubro". */
export function formatDayLongPt(date: Date = new Date()): string {
  return dayLongFormatter.format(date);
}

const timeFormatter = new Intl.DateTimeFormat("pt-PT", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

/** Hora em HH:MM no fuso da aplicação. */
export function formatTimePt(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return timeFormatter.format(d);
}

/**
 * Lê um número escrito à portuguesa ou à inglesa:
 * "1234,56", "1.234,56", "1 234,56", "1234.56", "1,234.56", "1.234.567".
 * Quando há "," e ".", o último é o separador decimal. Um único "." é
 * tratado como decimal (compatível com o formato do extrato XTB).
 * Devolve NaN quando a entrada não é um número inequívoco.
 */
export function parseNumberPt(input: string): number {
  let s = String(input ?? "")
    .replace(/\s/g, "") // \s inclui espaços inseparáveis (U+00A0, U+202F)
    .replace(/[€%]/g, "");
  if (!s) return Number.NaN;
  if (!/^-?[\d.,]+$/.test(s)) return Number.NaN;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;

  if (commas > 0 && dots > 0) {
    if (lastComma > lastDot) {
      // PT: "." milhares, "," decimal
      if (commas > 1) return Number.NaN;
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // EN: "," milhares, "." decimal
      if (dots > 1) return Number.NaN;
      s = s.replace(/,/g, "");
    }
  } else if (commas > 0) {
    if (commas > 1) return Number.NaN;
    s = s.replace(",", ".");
  } else if (dots > 1) {
    // "1.234.567": pontos só podem ser separadores de milhares
    if (!/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number.NaN;
    s = s.replace(/\./g, "");
  }

  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return Number.NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** `parseNumberPt` com valor por omissão para entradas inválidas. */
export function parseNumberOr(input: string, fallback: number): number {
  const n = parseNumberPt(input);
  return Number.isFinite(n) ? n : fallback;
}
