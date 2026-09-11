import { createFileRoute } from "@tanstack/react-router";
import { AssetClassPage } from "@/components/asset-class-page";

export const Route = createFileRoute("/_authenticated/acoes-crescimento")({
  head: () => ({
    meta: [
      { title: "Ações de Crescimento — Portefólio Tracker" },
      { name: "description", content: "Ações de empresas com foco em crescimento de capital." },
      { property: "og:title", content: "Ações de Crescimento — Portefólio Tracker" },
      {
        property: "og:description",
        content: "Ações de empresas com foco em crescimento de capital.",
      },
    ],
  }),
  component: AcoesCrescimentoPage,
});

function AcoesCrescimentoPage() {
  return (
    <AssetClassPage
      assetClass="acao_crescimento"
      title="Ações de Crescimento"
      subtitle="Ações de empresas com foco em crescimento de capital."
      emptyLabel="Ainda não tens ações de crescimento"
    />
  );
}
