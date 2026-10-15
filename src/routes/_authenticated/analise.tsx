import { createFileRoute, redirect } from "@tanstack/react-router";

/** Página antiga: o conteúdo passou para /performance. Mantém os links guardados. */
export const Route = createFileRoute("/_authenticated/analise")({
  beforeLoad: () => {
    throw redirect({ to: "/performance", replace: true });
  },
});
