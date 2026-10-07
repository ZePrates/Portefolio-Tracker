/** Esquemas zod partilhados pelas server functions. */
import { z } from "zod";
import { isValidISODate, todayLisbon } from "@/lib/dates";
import { ISIN_PATTERN } from "@/lib/identifiers";

/** Data de calendário real em YYYY-MM-DD (rejeita "abc" e 2026-02-30). */
export const isoDate = z
  .string()
  .trim()
  .refine(isValidISODate, "Data inválida (formato esperado: AAAA-MM-DD).");

/** Data de um movimento: válida, não futura e posterior a 1990. */
export const tradeDate = isoDate
  .refine((d) => d >= "1990-01-01", "Data demasiado antiga.")
  .refine((d) => d <= todayLisbon(), "A data do movimento não pode ser futura.");

/** Código de moeda ISO 4217 em maiúsculas. */
export const currencyCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, "Moeda inválida (ex.: EUR, USD)."));

/** ISIN (ISO 6166): 2 letras do país + 9 alfanuméricos + dígito de controlo. */
export const isinCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(ISIN_PATTERN, "ISIN inválido."));
