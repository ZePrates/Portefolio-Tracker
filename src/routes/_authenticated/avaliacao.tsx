import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, HeartPulse, Scale, UserCheck } from "lucide-react";
import { Card, PageHeader } from "@/components/ui-bits";
import { tabSearch } from "@/lib/tab-search";
import { getValuationCandidates } from "@/lib/valuation.functions";
import { PortfolioRadar } from "@/components/valuation/portfolio-radar";
import { ValuationSearch } from "@/components/valuation/valuation-search";
import { WatchlistCard } from "@/components/valuation/watchlist-card";
import { cleanSymbol } from "@/lib/valuation/symbol";
import {
  VALUATION_TABS,
  ValuationView,
  type ValuationTab,
} from "@/components/valuation/valuation-view";

const DESCRIPTION =
  "Quanto vale realmente uma ação: valor justo por vários modelos, saúde financeira e qualidade da gestão, com cada cálculo explicado.";

const tabOf = tabSearch(VALUATION_TABS);

export const Route = createFileRoute("/_authenticated/avaliacao")({
  head: () => ({
    meta: [
      { title: "Avaliação de ações — Portefólio Tracker" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Avaliação de ações — Portefólio Tracker" },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { t?: string; tab?: ValuationTab } => {
    const t = typeof search["t"] === "string" ? cleanSymbol(search["t"]) : null;
    return { ...(t ? { t } : {}), ...tabOf(search) };
  },
  component: AvaliacaoPage,
});

function AvaliacaoPage() {
  const { t, tab = "resumo" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const candidatesFn = useServerFn(getValuationCandidates);
  const candidates = useQuery({
    queryKey: ["valuation-candidates"],
    queryFn: () => candidatesFn(),
    staleTime: 5 * 60_000,
  });
  const open = (symbol: string) => void navigate({ search: { t: symbol } });
  const setTab = (next: ValuationTab) =>
    void navigate({
      search: { ...(t ? { t } : {}), ...(next === "resumo" ? {} : { tab: next }) },
      replace: true,
    });

  return (
    <div className="space-y-6">
      <PageHeader title="Avaliação de ações" subtitle={DESCRIPTION} />
      <ValuationSearch onPick={open} candidates={candidates.data ?? []} current={t} />
      {t ? (
        <ValuationView key={t} symbol={t} tab={tab} onTab={setTab} />
      ) : (
        <>
          <PortfolioRadar
            candidates={candidates.data ?? []}
            loading={candidates.isLoading}
            onOpen={open}
          />
          <WatchlistCard onOpen={open} />
          <HowItWorks />
        </>
      )}
    </div>
  );
}

function HowItWorks() {
  const items = [
    {
      icon: Scale,
      title: "Valor justo",
      text: "DCF com 3 cenários, DCF invertido, sensibilidade e Monte Carlo; múltiplos dos pares; dividendos (DDM e PVGO); lucro económico (EVA/MVA). Escolhidos e ponderados pelo tipo de empresa: madura, em crescimento, cíclica, banco ou REIT.",
    },
    {
      icon: HeartPulse,
      title: "Saúde financeira",
      text: "Altman Z-Score (risco de falência), Piotroski F-Score (evolução), Beneish M-Score (qualidade dos lucros), equilíbrio financeiro, DuPont e mais de 25 rácios.",
    },
    {
      icon: UserCheck,
      title: "Gestão e contexto",
      text: "ROIC face ao WACC, recompras e diluição, resultados face ao esperado, insiders, consenso dos analistas, FED Model, Yardeni e o risco do país (Damodaran).",
    },
    {
      icon: Building2,
      title: "REITs e bancos",
      text: "REITs por FFO/AFFO, NAV e cap rate, com nota de 0 a 10. Bancos pelo P/VC justificado e pelo retorno em excesso do capital próprio.",
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((i) => (
        <Card
          key={i.title}
          title={i.title}
          icon={<i.icon aria-hidden className="h-4 w-4 text-primary" />}
        >
          <p className="text-[13px] leading-relaxed text-muted-foreground">{i.text}</p>
        </Card>
      ))}
      <p className="text-[12px] text-muted-foreground md:col-span-2 xl:col-span-4">
        Dados públicos do Yahoo Finance, do BCE e do Prof. Aswath Damodaran. Ferramenta de estudo:
        os valores são estimativas e não constituem recomendação de investimento.
      </p>
    </div>
  );
}
