import { createFileRoute } from "@tanstack/react-router";
import { ScramblePanel } from "@/components/scramble-panel";

const DESCRIPTION =
  "Conta P2P na Scramble: rondas, calendário de reembolsos, juros a receber e IRS.";

export const Route = createFileRoute("/_authenticated/p2p")({
  head: () => ({
    meta: [
      { title: "P2P — Portefólio Tracker" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "P2P — Portefólio Tracker" },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: ScramblePanel,
});
