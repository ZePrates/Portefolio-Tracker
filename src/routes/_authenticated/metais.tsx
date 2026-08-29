import { createFileRoute } from "@tanstack/react-router";
import { AssetClassPage } from "@/components/asset-class-page";

export const Route = createFileRoute("/_authenticated/metais")({
  head: () => ({
    meta: [
      { title: "Metais Preciosos — Portefólio Tracker" },
      { name: "description", content: "Ouro e prata físicos em cofre — peso em gramas." },
      { property: "og:title", content: "Metais Preciosos — Portefólio Tracker" },
      { property: "og:description", content: "Ouro e prata físicos em cofre — peso em gramas." },
    ],
  }),
  component: MetaisPage,
});

function MetaisPage() {
  return (
    <AssetClassPage
      assetClass="metal"
      title="Metais Preciosos"
      subtitle="Ouro e prata físicos em cofre — peso em gramas."
      emptyLabel="Ainda não tens metais preciosos"
    />
  );
}
