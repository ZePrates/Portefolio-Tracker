import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChartColumn,
  Coins,
  Ellipsis,
  Eye,
  EyeOff,
  Keyboard,
  LayoutDashboard,
  Layers,
  LogOut,
  Monitor,
  Moon,
  PieChart,
  Search,
  Sun,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePrivateMode } from "@/components/private-mode";
import { useTheme, type ThemeChoice } from "@/components/theme";
import { useAppShell } from "@/components/app-shell";
import { Modal } from "@/components/ui-bits";
import { ANALYSIS_NAV, ASSETS_NAV, DASHBOARD_NAV, type NavItem } from "@/components/nav-config";
import { cn } from "@/lib/utils";

const THEMES: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Tema claro", icon: Sun },
  { value: "dark", label: "Tema escuro", icon: Moon },
  { value: "system", label: "Tema automático (segue o sistema)", icon: Monitor },
];

/** Escolha de tema: claro, escuro ou automático. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="group"
      aria-label="Tema"
      className={cn("inline-flex rounded-lg border border-border p-0.5", className)}
    >
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            theme === value
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon aria-hidden className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

function useSignOut() {
  const navigate = useNavigate();
  return async () => {
    await supabase.auth.signOut();
    void navigate({ to: "/auth" });
  };
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.to}>
          <Link
            to={item.to}
            onClick={onNavigate}
            activeOptions={{ exact: item.to === "/" }}
            className="nav-link relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <item.icon aria-hidden className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
        <ChartColumn aria-hidden className="h-5 w-5 text-primary-foreground" />
      </div>
      <div>
        <p className="text-sm font-semibold leading-tight">Portefólio</p>
        <p className="text-micro font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Tracker
        </p>
      </div>
    </div>
  );
}

const FOOTER_BUTTON =
  "flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground";

function DesktopSidebar() {
  const { hidden, toggle } = usePrivateMode();
  const { openPalette, openHelp } = useAppShell();
  const signOut = useSignOut();

  return (
    <aside
      aria-label="Navegação principal"
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex"
    >
      <div className="border-b border-sidebar-border px-5 py-5">
        <Brand />
      </div>

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={openPalette}
          className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <Search aria-hidden className="h-4 w-4" />
          Pesquisar…
          <kbd className="ml-auto rounded border border-border px-1.5 text-micro">Ctrl K</kbd>
        </button>
      </div>

      <nav aria-label="Páginas" className="flex-1 overflow-y-auto px-3 py-4">
        <NavLinks items={DASHBOARD_NAV} />

        <p className="px-3 pb-2 pt-6 text-micro font-bold uppercase tracking-[0.15em] text-muted-foreground">
          Ativos
        </p>
        <NavLinks items={ASSETS_NAV} />

        <p className="px-3 pb-2 pt-6 text-micro font-bold uppercase tracking-[0.15em] text-muted-foreground">
          Análise
        </p>
        <NavLinks items={ANALYSIS_NAV} />
      </nav>

      <div className="space-y-1 border-t border-sidebar-border px-3 py-3">
        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-xs font-medium text-muted-foreground">Tema</span>
          <ThemeToggle />
        </div>
        <button type="button" onClick={toggle} aria-pressed={hidden} className={FOOTER_BUTTON}>
          {hidden ? (
            <EyeOff aria-hidden className="h-4 w-4" />
          ) : (
            <Eye aria-hidden className="h-4 w-4" />
          )}
          Modo privado
          <span
            aria-hidden
            className={cn(
              "ml-auto h-2 w-2 rounded-full",
              hidden ? "bg-primary" : "bg-border-strong",
            )}
          />
        </button>
        <button type="button" onClick={openHelp} className={FOOTER_BUTTON}>
          <Keyboard aria-hidden className="h-4 w-4" />
          Atalhos
          <kbd className="ml-auto rounded border border-border px-1.5 text-micro">?</kbd>
        </button>
        <button type="button" onClick={signOut} className={FOOTER_BUTTON}>
          <LogOut aria-hidden className="h-4 w-4" />
          Sair
        </button>
        <p className="px-3 pt-1 text-micro font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Valores em EUR
        </p>
      </div>
    </aside>
  );
}

function MobileTopBar() {
  const { hidden, toggle } = usePrivateMode();
  const { openPalette } = useAppShell();
  const iconButton =
    "inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-sidebar-accent";
  return (
    <header className="sticky top-0 z-40 flex items-center gap-1 border-b border-border bg-sidebar/95 px-4 py-2 backdrop-blur lg:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <ChartColumn aria-hidden className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="truncate text-sm font-semibold">Portefólio Tracker</span>
      </div>
      <button
        type="button"
        onClick={openPalette}
        aria-label="Pesquisar"
        className={cn(iconButton, "text-muted-foreground")}
      >
        <Search aria-hidden className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={hidden}
        aria-label="Modo privado"
        className={cn(iconButton, hidden ? "text-primary" : "text-muted-foreground")}
      >
        {hidden ? (
          <EyeOff aria-hidden className="h-5 w-5" />
        ) : (
          <Eye aria-hidden className="h-5 w-5" />
        )}
      </button>
    </header>
  );
}

type SheetId = "ativos" | "analise" | "mais";

function SheetLinks({ items, onNavigate }: { items: NavItem[]; onNavigate: () => void }) {
  return (
    <ul className="grid gap-1">
      {items.map((item) => (
        <li key={item.to}>
          <Link
            to={item.to}
            onClick={onNavigate}
            className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-accent"
          >
            <item.icon aria-hidden className="h-5 w-5 text-muted-foreground" />
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MobileBottomNav() {
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { hidden, toggle } = usePrivateMode();
  const { openPalette, openHelp } = useAppShell();
  const signOut = useSignOut();

  const close = () => setSheet(null);
  const inGroup = (items: NavItem[]) => items.some((i) => pathname === i.to);
  // "Dividendos" tem botão próprio na barra; o resto da Análise fica na folha.
  const analysisRest = ANALYSIS_NAV.filter((i) => i.to !== "/dividendos");

  const tab = (active: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-micro font-medium transition-colors",
      active ? "text-primary" : "text-muted-foreground hover:text-foreground",
    );

  const sheetButton = (id: SheetId, label: string, icon: ReactNode, active: boolean) => (
    <button
      type="button"
      onClick={() => setSheet(id)}
      aria-haspopup="dialog"
      className={tab(active)}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <>
      <nav
        aria-label="Navegação"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-sidebar/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <Link to="/" className={tab(pathname === "/")}>
          <LayoutDashboard aria-hidden className="h-5 w-5" />
          Painel
        </Link>
        {sheetButton(
          "ativos",
          "Ativos",
          <Layers aria-hidden className="h-5 w-5" />,
          inGroup(ASSETS_NAV),
        )}
        <Link to="/dividendos" className={tab(pathname === "/dividendos")}>
          <Coins aria-hidden className="h-5 w-5" />
          Dividendos
        </Link>
        {sheetButton(
          "analise",
          "Análise",
          <PieChart aria-hidden className="h-5 w-5" />,
          inGroup(analysisRest),
        )}
        {sheetButton("mais", "Mais", <Ellipsis aria-hidden className="h-5 w-5" />, false)}
      </nav>

      <Modal open={sheet === "ativos"} onClose={close} title="Ativos">
        <SheetLinks items={ASSETS_NAV} onNavigate={close} />
      </Modal>
      <Modal open={sheet === "analise"} onClose={close} title="Análise">
        <SheetLinks items={analysisRest} onNavigate={close} />
      </Modal>
      <Modal open={sheet === "mais"} onClose={close} title="Mais">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Tema</span>
            <ThemeToggle />
          </div>
          <ul className="grid gap-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  close();
                  openPalette();
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-accent"
              >
                <Search aria-hidden className="h-5 w-5 text-muted-foreground" />
                Pesquisar
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={toggle}
                aria-pressed={hidden}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-accent"
              >
                {hidden ? (
                  <EyeOff aria-hidden className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <Eye aria-hidden className="h-5 w-5 text-muted-foreground" />
                )}
                Modo privado
                <span className="ml-auto text-xs text-muted-foreground">
                  {hidden ? "Ligado" : "Desligado"}
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  close();
                  openHelp();
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-accent"
              >
                <Keyboard aria-hidden className="h-5 w-5 text-muted-foreground" />
                Atalhos de teclado
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={signOut}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-accent"
              >
                <LogOut aria-hidden className="h-5 w-5 text-muted-foreground" />
                Sair
              </button>
            </li>
          </ul>
          <p className="text-micro uppercase tracking-[0.2em] text-muted-foreground">
            Valores em EUR
          </p>
        </div>
      </Modal>
    </>
  );
}

export function AppSidebar() {
  return (
    <>
      <MobileTopBar />
      <DesktopSidebar />
      <MobileBottomNav />
    </>
  );
}
