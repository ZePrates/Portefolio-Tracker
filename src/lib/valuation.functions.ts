import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { dbError } from "@/lib/errors";
import { yahooSymbolFor } from "@/lib/yahoo";
import { fetchCompanyData, searchSymbols } from "@/lib/valuation/fundamentals.server";
import type { CompanyData } from "@/lib/valuation/types";
import type { SymbolHit } from "@/lib/valuation/yahoo-parse";

/** Símbolos do Yahoo: letras, números, ponto, hífen, "^" e "=". */
const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z0-9.\-^=&]+$/, "Símbolo inválido.");

/**
 * Dados públicos de uma empresa para a avaliação (Yahoo, BCE e, se houver
 * chave, Finnhub). O cálculo corre no browser, para os pressupostos poderem
 * ser alterados sem novo pedido.
 */
export const getCompanyData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        symbol: symbolSchema,
        peers: z.boolean().default(true),
        news: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<CompanyData> => {
    return fetchCompanyData(data.symbol, { peers: data.peers, news: data.news });
  });

/** Pesquisa de ações por nome ou símbolo. */
export const searchCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ q: z.string().trim().min(1).max(60) }).parse(input),
  )
  .handler(async ({ data }): Promise<SymbolHit[]> => {
    try {
      return await searchSymbols(data.q);
    } catch {
      return [];
    }
  });

export interface ValuationCandidate {
  assetId: string;
  name: string;
  symbol: string;
  class: "acao_crescimento" | "acao_dividendo" | "reit";
  currentValue: number;
}

/** Ações e REITs em carteira (posições abertas), com o símbolo do Yahoo. */
export const getValuationCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ValuationCandidate[]> => {
    const { data, error } = await context.supabase
      .from("assets")
      .select("id, name, ticker, class, status, price_source, quantity, current_value")
      .in("class", ["acao_crescimento", "acao_dividendo", "reit"]);
    if (error) throw dbError(error);
    const out: ValuationCandidate[] = [];
    for (const a of (data ?? []) as Array<{
      id: string;
      name: string;
      ticker: string | null;
      class: ValuationCandidate["class"];
      status: string | null;
      price_source: string | null;
      quantity: number | null;
      current_value: number | null;
    }>) {
      if (a.status === "closed" || !(Number(a.quantity) > 0)) continue;
      const symbol = yahooSymbolFor(a);
      if (!symbol) continue;
      out.push({
        assetId: a.id,
        name: a.name,
        symbol,
        class: a.class,
        currentValue: Number(a.current_value) || 0,
      });
    }
    return out.sort((x, y) => y.currentValue - x.currentValue);
  });
