import {
  Activity,
  Building2,
  Calculator,
  Coins,
  DollarSign,
  Gem,
  Globe,
  Goal,
  Handshake,
  Layers,
  LayoutDashboard,
  Lightbulb,
  PieChart,
  Target,
  TrendingUp,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Tecla do atalho "g" + tecla (ex.: g e → ETFs). */
  key?: string;
  /** Palavras extra para a pesquisa global. */
  keywords?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const DASHBOARD_NAV: NavItem[] = [
  {
    to: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    key: "d",
    keywords: "painel início resumo",
  },
];

export const ASSETS_NAV: NavItem[] = [
  { to: "/etfs", label: "ETFs", icon: Layers, key: "e", keywords: "fundos índice" },
  { to: "/reits", label: "REITs", icon: Building2, key: "r", keywords: "imobiliário" },
  {
    to: "/acoes-dividendos",
    label: "Ações Dividendos",
    icon: DollarSign,
    key: "a",
    keywords: "ações dividendo",
  },
  {
    to: "/acoes-crescimento",
    label: "Ações Crescimento",
    icon: TrendingUp,
    key: "c",
    keywords: "ações growth",
  },
  { to: "/metais", label: "Metais Preciosos", icon: Gem, key: "m", keywords: "ouro prata" },
  { to: "/p2p", label: "P2P", icon: Handshake, key: "p", keywords: "crowdlending empréstimos" },
];

export const ANALYSIS_NAV: NavItem[] = [
  { to: "/dividendos", label: "Dividendos", icon: Coins, key: "v", keywords: "rendimento passivo" },
  { to: "/analise", label: "Análise", icon: PieChart, key: "n", keywords: "concentração classes" },
  {
    to: "/performance",
    label: "Performance",
    icon: Activity,
    key: "f",
    keywords: "twr xirr rentabilidade",
  },
  {
    to: "/exposicao",
    label: "Exposição",
    icon: Globe,
    key: "x",
    keywords: "países setores empresas",
  },
  { to: "/objetivos", label: "Objetivos", icon: Target, key: "o", keywords: "fire alocação alvo" },
  { to: "/projecoes", label: "Projeções", icon: Goal, key: "j", keywords: "simulação futuro" },
  {
    to: "/simulador",
    label: "Simulador de Compra",
    icon: Calculator,
    key: "s",
    keywords: "comprar",
  },
  {
    to: "/inteligencia",
    label: "Inteligência",
    icon: Lightbulb,
    key: "i",
    keywords: "score alertas",
  },
];

export const NAV_GROUPS: NavGroup[] = [
  { id: "inicio", label: "Início", items: DASHBOARD_NAV },
  { id: "ativos", label: "Ativos", items: ASSETS_NAV },
  { id: "analise", label: "Análise", items: ANALYSIS_NAV },
];

export const ALL_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Mapa tecla → rota para os atalhos "g" + tecla. */
export const GO_SHORTCUTS: Record<string, NavItem> = Object.fromEntries(
  ALL_NAV.filter((i) => i.key).map((i) => [i.key as string, i]),
);
