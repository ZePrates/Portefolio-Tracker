import { Link, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Layers,
  Building2,
  DollarSign,
  TrendingUp,
  Gem,
  Handshake,
  Coins,
  PieChart,
  Eye,
  EyeOff,
  LogOut,
  ChartColumn,
  Globe,
  Goal,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePrivateMode } from "@/components/private-mode";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/etfs", label: "ETFs", icon: Layers },
  { to: "/reits", label: "REITs", icon: Building2 },
  { to: "/acoes-dividendos", label: "Ações Dividendos", icon: DollarSign },
  { to: "/acoes-crescimento", label: "Ações Crescimento", icon: TrendingUp },
  { to: "/metais", label: "Metais Preciosos", icon: Gem },
  { to: "/p2p", label: "P2P", icon: Handshake },
  { to: "/dividendos", label: "Dividendos", icon: Coins },
  { to: "/analise", label: "Análise", icon: PieChart },
  { to: "/exposicao", label: "Exposição", icon: Globe },
  { to: "/projecoes", label: "Projeções", icon: Goal },
  { to: "/simulador", label: "Simulador de Compra", icon: TrendingUp },
  { to: "/inteligencia", label: "Inteligência", icon: PieChart },
] as const;

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { hidden, toggle } = usePrivateMode();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
          <ChartColumn className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">Portefólio</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Tracker
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            activeOptions={{ exact: item.to === "/" }}
            activeProps={{
              className: "bg-sidebar-accent text-sidebar-primary",
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="space-y-1 border-t border-sidebar-border px-3 py-4">
        <button
          onClick={toggle}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          Modo privado
          <span
            className={cn(
              "ml-auto h-2 w-2 rounded-full",
              hidden ? "bg-primary" : "bg-muted",
            )}
          />
        </button>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
        <p className="px-3 pt-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
          Valores em EUR
        </p>
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-sidebar px-4 py-3 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <ChartColumn className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold">Portefólio Tracker</span>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 bg-sidebar">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarContent />
      </aside>
    </>
  );
}
