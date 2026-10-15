import { createFileRoute, redirect } from "@tanstack/react-router";

/** Página antiga: o conteúdo passou para /dividendos (separador calendario). Mantém os links guardados. */
export const Route = createFileRoute("/_authenticated/calendario")({
  beforeLoad: () => {
    throw redirect({ to: "/dividendos", search: { tab: "calendario" }, replace: true });
  },
});
