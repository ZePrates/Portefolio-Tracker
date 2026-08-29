import { createFileRoute } from "@tanstack/react-router";
import { AssetClassPage } from "@/components/asset-class-page";

export const Route = createFileRoute("/_authenticated/reits")({
  head: () => ({
    meta: [
      { title: "REITs — Portefólio Tracker" },
      { name: "description", content: "Fundos de investimento imobiliário — rendimento via dividendos." },
      { property: "og:title", content: "REITs — Portefólio Tracker" },
      { property: "og:description", content: "Fundos de investimento imobiliário — rendimento via dividendos." },
    ],
  }),
  component: ReitsPage,
});

function ReitsPage() {
  return (
    <AssetClassPage
      assetClass="reit"
      title="REITs"
      subtitle="Fundos de investimento imobiliário — rendimento via dividendos."
      emptyLabel="Ainda não tens REITs"
    />
  );
}
