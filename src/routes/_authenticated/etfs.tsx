import { createFileRoute } from "@tanstack/react-router";
import { EtfCoverageSection } from "@/components/etf-coverage";
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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
    <div className="min-w-0 space-y-6">
    <AssetClassPage
      assetClass="etf"
      title="ETFs"
      subtitle="Fundos negociados em bolsa — exposição diversificada por índice, setor ou geografia."
      emptyLabel="Ainda não tens ETFs"
    />
    <EtfCoverageSection />
    </div>
  );
}
