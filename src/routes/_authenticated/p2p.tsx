import { createFileRoute } from "@tanstack/react-router";
import { AssetClassPage } from "@/components/asset-class-page";

export const Route = createFileRoute("/_authenticated/p2p")({
  head: () => ({
    meta: [
      { title: "P2P — Portefólio Tracker" },
      { name: "description", content: "Empréstimos a marcas europeias de bens de consumo. Grupo A até 12.4% · Grupo B até 25%." },
      { property: "og:title", content: "P2P — Portefólio Tracker" },
      { property: "og:description", content: "Empréstimos a marcas europeias de bens de consumo. Grupo A até 12.4% · Grupo B até 25%." },
    ],
  }),
  component: P2pPage,
});

function P2pPage() {
  return (
    <AssetClassPage
      assetClass="p2p"
      title="P2P"
      subtitle="Empréstimos a marcas europeias de bens de consumo. Grupo A até 12.4% · Grupo B até 25%."
      emptyLabel="Ainda não tens contas P2P"
    />
  );
}
