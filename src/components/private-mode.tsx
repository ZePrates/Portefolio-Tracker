import { createContext, useContext, useState, type ReactNode } from "react";

interface PrivateModeContextValue {
  hidden: boolean;
  toggle: () => void;
}

const PrivateModeContext = createContext<PrivateModeContextValue>({
  hidden: false,
  toggle: () => {},
});

export function PrivateModeProvider({ children }: { children: ReactNode }) {
  // As rotas autenticadas não são renderizadas no servidor, por isso pode ler-se
  // o valor guardado logo na primeira pintura (sem mostrar os valores um instante).
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem("pt_private_mode") === "1";
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setHidden((prev) => {
      try {
        window.localStorage.setItem("pt_private_mode", prev ? "0" : "1");
      } catch {
        // Sem armazenamento: o modo vale só nesta sessão.
      }
      return !prev;
    });
  };

  return (
    <PrivateModeContext.Provider value={{ hidden, toggle }}>{children}</PrivateModeContext.Provider>
  );
}

export function usePrivateMode() {
  return useContext(PrivateModeContext);
}
