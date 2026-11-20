/** Normaliza o que o utilizador escreveu para um símbolo do Yahoo (null se for inválido). */
export function cleanSymbol(text: string): string | null {
  const s = text.trim().toUpperCase();
  return /^[A-Z0-9.\-^=&]{1,24}$/.test(s) ? s : null;
}
