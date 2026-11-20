import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ErrorState, KpiGridSkeleton } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { PageTabs } from "@/components/page-tabs";
import { analyzeCompany } from "@/lib/valuation/analyze";
import type { Assumptions } from "@/lib/valuation/assumptions";
import { getCompanyData } from "@/lib/valuation.functions";
import { ValuationHeader } from "@/components/valuation/valuation-header";
import { WatchlistButton } from "@/components/valuation/watchlist-button";
import { ValuationSummary } from "@/components/valuation/valuation-summary";
import { ValuationFairValue } from "@/components/valuation/valuation-fair-value";
import { ValuationHealth } from "@/components/valuation/valuation-health";
import { ValuationManagement } from "@/components/valuation/valuation-management";
import { ValuationReit } from "@/components/valuation/valuation-reit";
import { ValuationMacro } from "@/components/valuation/valuation-macro";
import { ValuationNews, ValuationStatements } from "@/components/valuation/valuation-statements";

export const VALUATION_TABS = [
  "resumo",
  "valor",
  "saude",
  "gestao",
  "reit",
  "macro",
  "contas",
  "noticias",
] as const;
export type ValuationTab = (typeof VALUATION_TABS)[number];

/** Análise completa de uma empresa. Montar com `key={symbol}` para repor os pressupostos. */
export function ValuationView({
  symbol,
  tab,
  onTab,
}: {
  symbol: string;
  tab: ValuationTab;
  onTab: (t: ValuationTab) => void;
}) {
  const fetchFn = useServerFn(getCompanyData);
  const q = useQuery({
    queryKey: ["valuation", symbol, "full"],
    queryFn: () => fetchFn({ data: { symbol, peers: true, news: true } }),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const [overrides, setOverrides] = useState<Partial<Assumptions>>({});
  const analysis = useMemo(
    () => (q.data ? analyzeCompany(q.data, overrides) : null),
    [q.data, overrides],
  );

  if (q.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label={`A analisar ${symbol}`}>
        <Skeleton className="h-48 w-full rounded-xl" />
        <KpiGridSkeleton />
        <p className="text-[12.5px] text-muted-foreground">
          A recolher cotação, demonstrações financeiras, consenso, insiders e pares de {symbol}…
        </p>
      </div>
    );
  }
  if (q.error || !q.data || !analysis) {
    return (
      <ErrorState
        title={`Não foi possível analisar ${symbol}`}
        description={q.error instanceof Error ? q.error.message : "Tenta outra vez daqui a pouco."}
        onRetry={() => void q.refetch()}
      />
    );
  }

  const data = q.data;
  const isReit = analysis.classification.type === "reit";
  const active: ValuationTab = tab === "reit" && !isReit ? "resumo" : tab;
  const tabs = [
    {
      id: "resumo" as const,
      label: "Resumo",
      content: <ValuationSummary data={data} analysis={analysis} />,
    },
    {
      id: "valor" as const,
      label: "Valor justo",
      content: (
        <ValuationFairValue
          data={data}
          analysis={analysis}
          overrides={overrides}
          onOverrides={setOverrides}
        />
      ),
    },
    {
      id: "saude" as const,
      label: "Saúde financeira",
      content: <ValuationHealth data={data} analysis={analysis} />,
    },
    {
      id: "gestao" as const,
      label: "Gestão",
      content: <ValuationManagement data={data} analysis={analysis} />,
    },
    ...(isReit
      ? [
          {
            id: "reit" as const,
            label: "REIT",
            content: <ValuationReit data={data} analysis={analysis} />,
          },
        ]
      : []),
    {
      id: "macro" as const,
      label: "Macro e Damodaran",
      content: <ValuationMacro data={data} analysis={analysis} />,
    },
    { id: "contas" as const, label: "Demonstrações", content: <ValuationStatements data={data} /> },
    { id: "noticias" as const, label: "Notícias", content: <ValuationNews data={data} /> },
  ];

  return (
    <div className="space-y-6">
      <ValuationHeader
        data={data}
        analysis={analysis}
        onRefresh={() => void q.refetch()}
        refreshing={q.isFetching}
        actions={<WatchlistButton symbol={data.profile.symbol} name={data.profile.name} />}
      />
      {Object.keys(overrides).length > 0 && (
        <p className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-[12.5px]">
          Estás a ver a avaliação com {Object.keys(overrides).length} pressuposto(s) alterado(s) por
          ti (separador Valor justo).
        </p>
      )}
      <PageTabs label="Secções da avaliação" value={active} onChange={onTab} tabs={tabs} />
    </div>
  );
}
