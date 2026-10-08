import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "pt-theme";
const DEFAULT_THEME: ThemeChoice = "dark";

/**
 * Corre no <head>, antes da primeira pintura, para evitar o "flash" do tema
 * errado. Tem de ficar em sincronia com `applyTheme` abaixo.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}")||"${DEFAULT_THEME}";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){document.documentElement.classList.add("dark")}})();`;

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readChoice(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(choice: ThemeChoice): "light" | "dark" {
  const resolved = choice === "system" ? (prefersDark() ? "dark" : "light") : choice;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  return resolved;
}

interface ThemeContextValue {
  /** Escolha do utilizador (inclui "automático"). */
  theme: ThemeChoice;
  /** Tema efetivamente aplicado. */
  resolved: "light" | "dark";
  setTheme: (theme: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  resolved: "dark",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Valor inicial estável para a hidratação; o real é lido logo a seguir.
  const [theme, setThemeState] = useState<ThemeChoice>(DEFAULT_THEME);
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const choice = readChoice();
    setThemeState(choice);
    setResolved(applyTheme(choice));
  }, []);

  // No modo automático, acompanha a preferência do sistema em tempo real.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(applyTheme("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sem armazenamento (modo privado do browser): aplica só nesta sessão.
    }
    setThemeState(next);
    setResolved(applyTheme(next));
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
