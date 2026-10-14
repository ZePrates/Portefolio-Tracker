import { createFileRoute } from "@tanstack/react-router";
import { AssetClassPage } from "@/components/asset-class-page";

export const Route = createFileRoute("/_authenticated/acoes-dividendos")({
  head: () => ({
    meta: [
      { title: "Ações Dividendos — Portefólio Tracker" },
      { name: "description", content: "Ações de empresas que distribuem dividendos regularmente." },
      { property: "og:title", content: "Ações Dividendos — Portefólio Tracker" },
      {
        property: "og:description",
        content: "Ações de empresas que distribuem dividendos regularmente.",
      },
    ],
  }),
  component: AcoesDividendosPage,
});

function AcoesDividendosPage() {
  return (
    <AssetClassPage
      assetClass="acao_dividendo"
      title="Ações Dividendos"
      subtitle="Ações de empresas que distribuem dividendos regularmente."
      emptyLabel="Ainda não tens ações de dividendos"
    />
  );
}
