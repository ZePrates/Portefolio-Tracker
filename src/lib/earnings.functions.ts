import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { todayLisbon, addDaysISO } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { fetchWithTimeout, mapWithConcurrency } from "@/lib/http";
import {
  EARNINGS_HORIZON_DAYS,
  finnhubSymbol,
  parseFinnhubEarnings,
  upcomingEarnings,
  type EarningsAsset,
  type EarningsEvent,
} from "@/lib/earnings";

const FINNHUB_URL = "https://api.finnhub.io/api/v1/calendar/earnings";

export interface EarningsCalendarResult {
  /** false quando FINNHUB_API_KEY não está definida (o cartão explica como ativar). */
  configured: boolean;
  events: EarningsEvent[];
  /** Símbolos cujo pedido falhou (rede, limite, chave inválida). */
  failed: string[];
  checked: number;
}

/**
 * Próximos resultados das ações e REITs em carteira, a partir do Finnhub.
 * Um pedido por símbolo (o calendário global vem truncado), no máximo 3 em
 * simultâneo para ficar abaixo do limite gratuito (60/min). A chave é lida do
 * ambiente do servidor e nunca chega ao browser.
 */
export const getEarningsCalendar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EarningsCalendarResult> => {
    const key = process.env["FINNHUB_API_KEY"]?.trim();
    if (!key) return { configured: false, events: [], failed: [], checked: 0 };

    const { data, error } = await context.supabase
      .from("assets")
      .select("id, name, ticker, class, status");
    if (error) throw dbError(error);

    const bySymbol = new Map<string, EarningsAsset>();
    for (const a of (data ?? []) as EarningsAsset[]) {
      const s = finnhubSymbol(a);
      if (s && !bySymbol.has(s)) bySymbol.set(s, a);
    }

    const today = todayLisbon();
    const to = addDaysISO(today, EARNINGS_HORIZON_DAYS);
    const failed: string[] = [];
    const results = await mapWithConcurrency([...bySymbol.entries()], 3, async ([symbol, a]) => {
      const url = `${FINNHUB_URL}?from=${today}&to=${to}&symbol=${encodeURIComponent(symbol)}`;
      try {
        const res = await fetchWithTimeout(url, { headers: { "X-Finnhub-Token": key } });
        if (!res.ok) {
          failed.push(symbol);
          return [];
        }
        return parseFinnhubEarnings(await res.json(), a, symbol);
      } catch {
        failed.push(symbol);
        return [];
      }
    });

    return {
      configured: true,
      events: upcomingEarnings(results.flat(), today),
      failed: failed.sort(),
      checked: bySymbol.size,
    };
  });
