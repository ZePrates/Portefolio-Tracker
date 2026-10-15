import { createFileRoute, redirect } from "@tanstack/react-router";

/** Página antiga: o conteúdo passou para /objetivos (separador projecoes). Mantém os links guardados. */
export const Route = createFileRoute("/_authenticated/projecoes")({
  beforeLoad: () => {
    throw redirect({ to: "/objetivos", search: { tab: "projecoes" }, replace: true });
  },
});
