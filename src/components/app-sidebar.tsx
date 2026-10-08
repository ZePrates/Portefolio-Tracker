import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useRouteContext, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
  Settings,
  Sun,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePrivateMode } from "@/components/private-mode";
import { useTheme, type ThemeChoice } from "@/components/theme";
import { useAppShell } from "@/components/app-shell";
import { IconButton, Modal } from "@/components/ui-bits";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CLASS_COLOR } from "@/components/chart-kit";
import { listAssets } from "@/lib/portfolio.functions";
import { allocationByClass } from "@/lib/dashboard";
import { formatPct } from "@/lib/format";
import type { Asset, AssetClass } from "@/lib/portfolio-types";
import {
  ANALYSIS_NAV,
  ASSETS_NAV,
  CLASS_ROUTES,
  DASHBOARD_NAV,
  TOOLS_NAV,
  type NavItem,
} from "@/components/nav-config";
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

const NAV_ITEM =
  "nav-link relative flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 text-[13.5px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-foreground";

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <Link
            to={item.to}
            onClick={onNavigate}
            activeOptions={{ exact: item.to === "/" }}
            className={NAV_ITEM}
          >
            <item.icon aria-hidden className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const CLASS_OF_ROUTE = Object.fromEntries(
  Object.entries(CLASS_ROUTES).map(([cls, to]) => [to, cls as AssetClass]),
) as Record<string, AssetClass>;

/** Carteira: quadrado com a cor da classe e o peso na carteira à direita. */
function ClassNavLinks({ items }: { items: NavItem[] }) {
  const { hidden } = usePrivateMode();
  const fetchAssets = useServerFn(listAssets);
  const { data } = useQuery({ queryKey: ["assets"], queryFn: () => fetchAssets() });
  const weights = useMemo(
    () => new Map(allocationByClass((data ?? []) as Asset[]).map((c) => [c.class, c.pct])),
    [data],
  );
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const cls = CLASS_OF_ROUTE[item.to];
        const pct = cls ? weights.get(cls) : undefined;
        return (
          <li key={item.to}>
            <Link to={item.to} className={NAV_ITEM}>
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: cls ? CLASS_COLOR[cls] : undefined }}
              />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {pct !== undefined && (
                <span className="num text-xs font-normal text-muted-foreground">
                  {formatPct(pct, 0, hidden)}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NavSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <p className="px-3 pb-1.5 pt-5 text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </>
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

function initialsOf(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : local.slice(0, 2);
  return letters.toUpperCase() || "?";
}

/** Rodapé compacto: iniciais, "Valores em EUR", modo privado e menu de definições. */
function SidebarFooter() {
  const { hidden, toggle } = usePrivateMode();
  const { openHelp } = useAppShell();
  const { theme, setTheme } = useTheme();
  const signOut = useSignOut();
  const ctx = useRouteContext({ strict: false }) as { user?: { email?: string | null } };

  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border px-3 py-3">
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold"
      >
        {initialsOf(ctx.user?.email)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Valores em EUR</span>
      <IconButton label="Modo privado" aria-pressed={hidden} onClick={toggle}>
        {hidden ? (
          <EyeOff aria-hidden className="h-4 w-4 text-primary" />
        ) : (
          <Eye aria-hidden className="h-4 w-4" />
        )}
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Definições">
            <Settings aria-hidden className="h-4 w-4" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-56">
          <DropdownMenuLabel>Tema</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
            {THEMES.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon aria-hidden className="mr-2 h-4 w-4" />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={openHelp}>
            <Keyboard aria-hidden className="mr-2 h-4 w-4" />
            Atalhos de teclado
            <kbd className="ml-auto rounded border border-border px-1.5 text-micro">?</kbd>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut aria-hidden className="mr-2 h-4 w-4" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DesktopSidebar() {
  const { openPalette } = useAppShell();

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

        <NavSection label="Carteira">
          <ClassNavLinks items={ASSETS_NAV} />
        </NavSection>

        <NavSection label="Análise">
          <NavLinks items={ANALYSIS_NAV} />
        </NavSection>

        <NavSection label="Ferramentas">
          <NavLinks items={TOOLS_NAV} />
        </NavSection>
      </nav>

      <SidebarFooter />
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
          "Carteira",
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

      <Modal open={sheet === "ativos"} onClose={close} title="Carteira">
        <SheetLinks items={ASSETS_NAV} onNavigate={close} />
      </Modal>
      <Modal open={sheet === "analise"} onClose={close} title="Análise">
        <SheetLinks items={analysisRest} onNavigate={close} />
      </Modal>
      <Modal open={sheet === "mais"} onClose={close} title="Mais">
        <div className="space-y-4">
          <SheetLinks items={TOOLS_NAV} onNavigate={close} />
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
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
