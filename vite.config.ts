// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// BYO external Supabase project (azekwmamjovoguauncrg). These are PUBLIC client
// values (publishable anon key — safe to commit; RLS protects the data).
// They are baked in via `define` so both dev and the published build use the
// external project instead of the platform-managed Lovable Cloud env vars.
const EXTERNAL_SUPABASE_URL = "https://azekwmamjovoguauncrg.supabase.co";
const EXTERNAL_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MSU89f7NLAhrTTdff_euJQ_She4teR3";
const EXTERNAL_SUPABASE_PROJECT_ID = "azekwmamjovoguauncrg";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(EXTERNAL_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        EXTERNAL_SUPABASE_PUBLISHABLE_KEY,
      ),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(EXTERNAL_SUPABASE_PROJECT_ID),
    },
  },
});
