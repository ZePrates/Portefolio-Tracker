import { createFileRoute } from "@tanstack/react-router";
import { AssetClassPage } from "@/components/asset-class-page";

export const Route = createFileRoute("/_authenticated/etfs")({
  head: () => ({
    meta: [
      { title: "ETFs — Portefólio Tracker" },
      {
        name: "description",
        content:
          "Fundos negociados em bolsa — exposição diversificada por índice, setor ou geografia.",
      },
      { property: "og:title", content: "ETFs — Portefólio Tracker" },
      {
        property: "og:description",
        content:
          "Fundos negociados em bolsa — exposição diversificada por índice, setor ou geografia.",
      },
    ],
  }),
  component: EtfsPage,
});

function EtfsPage() {
  return (
    <AssetClassPage
      assetClass="etf"
      title="ETFs"
      subtitle="Fundos negociados em bolsa — exposição diversificada por índice, setor ou geografia."
      emptyLabel="Ainda não tens ETFs"
    />
  );
}
