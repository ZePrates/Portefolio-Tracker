import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface PrivateModeContextValue {
  hidden: boolean;
  toggle: () => void;
}

const PrivateModeContext = createContext<PrivateModeContextValue>({
  hidden: false,
  toggle: () => {},
});

export function PrivateModeProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(window.localStorage.getItem("pt_private_mode") === "1");
  }, []);

  const toggle = () => {
    setHidden((prev) => {
      window.localStorage.setItem("pt_private_mode", prev ? "0" : "1");
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
