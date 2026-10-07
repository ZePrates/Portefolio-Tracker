/**
 * Identificadores de títulos — sem dependências (seguro no bundle do cliente;
 * os esquemas zod em validation.ts reutilizam estes padrões).
 */

/** ISIN (ISO 6166): 2 letras do país + 9 alfanuméricos + dígito de controlo. */
export const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export function isValidIsin(value: string | null | undefined): boolean {
  return !!value && ISIN_PATTERN.test(value.trim().toUpperCase());
}
