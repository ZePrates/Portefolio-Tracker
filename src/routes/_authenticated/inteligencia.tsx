import { createFileRoute, redirect } from "@tanstack/react-router";

/** Página antiga: o conteúdo passou para /exposicao. Mantém os links guardados. */
export const Route = createFileRoute("/_authenticated/inteligencia")({
  beforeLoad: () => {
    throw redirect({ to: "/exposicao", replace: true });
  },
});
