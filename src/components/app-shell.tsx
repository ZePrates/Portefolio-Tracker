import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Eye, Keyboard, Moon, Monitor, Sun } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ALL_NAV, GO_SHORTCUTS, NAV_GROUPS } from "@/components/nav-config";
import { usePrivateMode } from "@/components/private-mode";
import { useTheme } from "@/components/theme";
import { Modal } from "@/components/ui-bits";
import { listAssets } from "@/lib/portfolio.functions";
import { type Asset, type AssetClass, CLASS_LABELS } from "@/lib/portfolio-types";
import { normalizeSearch } from "@/lib/table";

const CLASS_ROUTE: Record<AssetClass, string> = {
  etf: "/etfs",
  reit: "/reits",
  acao_dividendo: "/acoes-dividendos",
  acao_crescimento: "/acoes-crescimento",
  metal: "/metais",
  p2p: "/p2p",
};

interface AppShellValue {
  openPalette: () => void;
  openHelp: () => void;
}

const AppShellContext = createContext<AppShellValue>({
  openPalette: () => {},
  openHelp: () => {},
});

export function useAppShell() {
  return useContext(AppShellContext);
}

/** O foco está num campo de escrita? Então os atalhos de uma tecla não se aplicam. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

const isDialogOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');

/**
 * Pesquisa global (Ctrl/⌘+K ou "/"), ajuda de atalhos ("?") e atalhos de teclado:
 * "g" seguido de uma letra navega; "p" alterna o modo privado.
 */
export function AppShellProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { toggle: togglePrivate, hidden } = usePrivateMode();
  const { setTheme } = useTheme();
  const fetchAssets = useServerFn(listAssets);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const { data: assetsRaw } = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetchAssets(),
    enabled: paletteOpen,
  });
  const assets = useMemo(() => (assetsRaw ?? []) as Asset[], [assetsRaw]);

  const go = useCallback(
    (to: string) => {
      setPaletteOpen(false);
      void navigate({ to });
    },
    [navigate],
  );

  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || isDialogOpen()) return;
      const key = e.key.toLowerCase();

      if (pendingG && Date.now() - pendingG < 1500) {
        pendingG = 0;
        const dest = GO_SHORTCUTS[key];
        if (dest) {
          e.preventDefault();
          go(dest.to);
        }
        return;
      }
      if (key === "g") pendingG = Date.now();
      else if (key === "p") togglePrivate();
      else if (key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "?") setHelpOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, togglePrivate]);

  const value = useMemo<AppShellValue>(
    () => ({ openPalette: () => setPaletteOpen(true), openHelp: () => setHelpOpen(true) }),
    [],
  );

  const searchValue = (label: string, extra = "") =>
    `${label} ${normalizeSearch(label)} ${normalizeSearch(extra)}`;

  return (
    <AppShellContext.Provider value={value}>
      {children}

      <DialogPrimitive.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed left-1/2 top-[12%] z-[60] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:zoom-in-95">
            <DialogPrimitive.Title className="sr-only">Pesquisa global</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Pesquisa páginas, ativos e ações. Usa as setas para escolher e Enter para abrir.
            </DialogPrimitive.Description>
            <Command label="Pesquisa global" className="max-h-[70dvh]">
              <CommandInput placeholder="Pesquisar páginas, ativos e ações…" />
              <CommandList className="max-h-[60dvh]">
                <CommandEmpty>Nada encontrado.</CommandEmpty>
                {NAV_GROUPS.map((g) => (
                  <CommandGroup key={g.id} heading={g.id === "inicio" ? "Páginas" : g.label}>
                    {g.items.map((item) => (
                      <CommandItem
                        key={item.to}
                        value={searchValue(item.label, item.keywords)}
                        onSelect={() => go(item.to)}
                      >
                        <item.icon aria-hidden className="mr-2 h-4 w-4 opacity-70" />
                        {item.label}
                        {item.key && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            g {item.key}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
                {assets.length > 0 && (
                  <CommandGroup heading="Ativos">
                    {assets.map((a) => (
                      <CommandItem
                        key={a.id}
                        value={searchValue(a.name, `${a.ticker ?? ""} ${a.isin ?? ""} ativo`)}
                        onSelect={() => go(CLASS_ROUTE[a.class] ?? "/")}
                      >
                        <span className="min-w-0 flex-1 truncate">{a.name}</span>
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                          {a.ticker ? `${a.ticker} · ` : ""}
                          {CLASS_LABELS[a.class]}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <CommandGroup heading="Ações">
                  <CommandItem
                    value={searchValue("Alternar modo privado", "esconder valores ocultar")}
                    onSelect={() => {
                      togglePrivate();
                      setPaletteOpen(false);
                    }}
                  >
                    <Eye aria-hidden className="mr-2 h-4 w-4 opacity-70" />
                    {hidden ? "Mostrar valores" : "Esconder valores"} (modo privado)
                    <span className="ml-auto text-xs text-muted-foreground">p</span>
                  </CommandItem>
                  {(
                    [
                      ["light", "Tema claro", Sun],
                      ["dark", "Tema escuro", Moon],
                      ["system", "Tema automático (sistema)", Monitor],
                    ] as const
                  ).map(([t, label, Icon]) => (
                    <CommandItem
                      key={t}
                      value={searchValue(label, "aparência tema")}
                      onSelect={() => {
                        setTheme(t);
                        setPaletteOpen(false);
                      }}
                    >
                      <Icon aria-hidden className="mr-2 h-4 w-4 opacity-70" />
                      {label}
                    </CommandItem>
                  ))}
                  <CommandItem
                    value={searchValue("Atalhos de teclado", "ajuda")}
                    onSelect={() => {
                      setPaletteOpen(false);
                      setHelpOpen(true);
                    }}
                  >
                    <Keyboard aria-hidden className="mr-2 h-4 w-4 opacity-70" />
                    Atalhos de teclado
                    <span className="ml-auto text-xs text-muted-foreground">?</span>
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Atalhos de teclado">
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Geral
            </dt>
            <dd>
              <ul className="space-y-1.5">
                <Shortcut keys="Ctrl/⌘ K  ou  /" label="Pesquisa global" />
                <Shortcut keys="p" label="Alternar modo privado" />
                <Shortcut keys="?" label="Mostrar esta ajuda" />
              </ul>
            </dd>
          </div>
          <div>
            <dt className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ir para (carrega g e depois a letra)
            </dt>
            <dd>
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {ALL_NAV.filter((i) => i.key).map((i) => (
                  <Shortcut key={i.to} keys={`g ${i.key}`} label={i.label} />
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </Modal>
    </AppShellContext.Provider>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 text-xs font-medium">
        {keys}
      </kbd>
    </li>
  );
}
