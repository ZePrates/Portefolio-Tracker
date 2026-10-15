import { createFileRoute, redirect } from "@tanstack/react-router";

/** Página antiga: o conteúdo passou para /objetivos (separador simulador). Mantém os links guardados. */
export const Route = createFileRoute("/_authenticated/simulador")({
  beforeLoad: () => {
    throw redirect({ to: "/objetivos", search: { tab: "simulador" }, replace: true });
  },
});
