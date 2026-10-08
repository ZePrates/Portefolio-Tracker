import { useCallback, useEffect, useState } from "react";

/**
 * Estado guardado em localStorage (preferências por visitante, como colunas
 * visíveis). Nunca falha: sem armazenamento disponível comporta-se como useState.
 */
export function usePersistentState<T>(
  key: string | undefined,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (!key) return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (!key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Sem armazenamento: a preferência vale só nesta sessão.
    }
  }, [key, state]);

  const set = useCallback((value: T | ((prev: T) => T)) => setState(value), []);
  return [state, set];
}
