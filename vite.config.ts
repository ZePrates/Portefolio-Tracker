import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Projeto Supabase externo (azekwmamjovoguauncrg). Estes valores são PÚBLICOS
// (chave publishable/anon — segura para commit; a RLS protege os dados) e ficam
// embutidos no build, em desenvolvimento e em produção.
// A chave de serviço (EXTERNAL_SUPABASE_SERVICE_KEY) NUNCA entra no repositório:
// é um segredo de ambiente do alojamento.
const EXTERNAL_SUPABASE_URL = "https://azekwmamjovoguauncrg.supabase.co";
const EXTERNAL_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MSU89f7NLAhrTTdff_euJQ_She4teR3";
const EXTERNAL_SUPABASE_PROJECT_ID = "azekwmamjovoguauncrg";

export default defineConfig(({ command, mode }) => {
  // Injeta as variáveis VITE_* (de .env) como constantes, também no servidor (SSR).
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), "VITE_"))) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return {
    define: {
      ...envDefine,
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(EXTERNAL_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        EXTERNAL_SUPABASE_PUBLISHABLE_KEY,
      ),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(EXTERNAL_SUPABASE_PROJECT_ID),
    },
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      ignoreOutdatedRequests: true,
    },
    server: { host: "::", port: 8080 },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Redireciona a entrada de servidor do TanStack Start para src/server.ts
        // (o nosso invólucro de erros de SSR). O nitro constrói a partir daqui.
        server: { entry: "server" },
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
      }),
      // O Nitro escolhe sozinho o alvo: na Vercel (VERCEL=1) gera o formato da
      // Vercel; noutros sítios, Node. Para forçar: NITRO_PRESET=vercel bun run build
      //
      // Agendamentos da Vercel (mais pontuais do que os do GitHub, que chegam a atrasar
      // horas). No plano Hobby cada um corre uma vez por dia, dentro da hora indicada
      // (UTC). O resumo das 9h corre às 8h e às 9h UTC porque Lisboa muda de hora; o
      // endpoint só envia a partir das 9h de Lisboa e uma vez por dia.
      ...(command === "build"
        ? [
            nitro({
              vercel: {
                config: {
                  version: 3,
                  crons: [
                    { path: "/api/public/cron/morning-digest", schedule: "0 8 * * 1-5" },
                    { path: "/api/public/cron/morning-digest", schedule: "0 9 * * 1-5" },
                  ],
                },
              },
            }),
          ]
        : []),
      viteReact(),
    ],
  };
});
