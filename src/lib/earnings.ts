/**
 * Calendário de resultados (earnings) — lógica pura, sem rede.
 * A fonte é a API do Finnhub (`/calendar/earnings`); ver earnings.functions.ts.
 */
import { addDaysISO, isValidISODate } from "@/lib/dates";

/** Classes com resultados trimestrais próprios (os ETFs não publicam). */
export const EARNINGS_CLASSES = new Set(["reit", "acao_dividendo", "acao_crescimento"]);

/** Janela de procura a partir de hoje. */
export const EARNINGS_HORIZON_DAYS = 90;

export type EarningsHour = "bmo" | "amc" | "dmh";

export interface EarningsEvent {
  symbol: string;
  /** Nome do ativo na carteira. */
  name: string;
  assetId: string;
  /** Data do anúncio (YYYY-MM-DD). */
  date: string;
  hour: EarningsHour | null;
  quarter: number | null;
  year: number | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
}

export interface EarningsAsset {
  id: string;
  name: string;
  ticker: string | null;
  class: string;
  status?: string | null;
}

/**
 * Símbolo Finnhub de um ativo. O plano gratuito cobre só bolsas dos EUA, por
 * isso tickers com sufixo de outra bolsa (".DE", ".L"…) ficam de fora em vez
 * de devolverem uma empresa errada com o mesmo ticker.
 */
export function finnhubSymbol(asset: EarningsAsset): string | null {
  if (!EARNINGS_CLASSES.has(asset.class)) return null;
  if (asset.status === "closed") return null;
  const t = asset.ticker?.trim().toUpperCase();
  if (!t) return null;
  const base = t.endsWith(".US") ? t.slice(0, -3) : t;
  if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(base)) return null;
  return base;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const HOURS = new Set<EarningsHour>(["bmo", "amc", "dmh"]);

/** Converte a resposta do Finnhub, descartando linhas inválidas ou de outro símbolo. */
export function parseFinnhubEarnings(json: unknown, asset: EarningsAsset, symbol: string) {
  const rows = (json as { earningsCalendar?: unknown })?.earningsCalendar;
  if (!Array.isArray(rows)) return [];
  const out: EarningsEvent[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const date = typeof r["date"] === "string" ? r["date"].slice(0, 10) : "";
    if (!isValidISODate(date)) continue;
    if (typeof r["symbol"] === "string" && r["symbol"].toUpperCase() !== symbol) continue;
    const hour = typeof r["hour"] === "string" ? (r["hour"].toLowerCase() as EarningsHour) : null;
    out.push({
      symbol,
      name: asset.name,
      assetId: asset.id,
      date,
      hour: hour && HOURS.has(hour) ? hour : null,
      quarter: num(r["quarter"]),
      year: num(r["year"]),
      epsEstimate: num(r["epsEstimate"]),
      revenueEstimate: num(r["revenueEstimate"]),
    });
  }
  return out;
}

/** Próximos anúncios dentro da janela, por data; um por empresa e data. */
export function upcomingEarnings(
  events: EarningsEvent[],
  today: string,
  horizonDays = EARNINGS_HORIZON_DAYS,
): EarningsEvent[] {
  const end = addDaysISO(today, horizonDays);
  const seen = new Set<string>();
  return events
    .filter((e) => e.date >= today && e.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol))
    .filter((e) => {
      const k = `${e.symbol}|${e.date}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function earningsHourLabel(hour: EarningsHour | null): string | null {
  switch (hour) {
    case "bmo":
      return "antes da abertura";
    case "amc":
      return "após o fecho";
    case "dmh":
      return "durante a sessão";
    default:
      return null;
  }
}
