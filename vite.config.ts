// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// BYO external Supabase: the platform injects managed SUPABASE_*/VITE_SUPABASE_*
// env vars that override .env/.env.local files, so we read .env.local here and
// bake the external project's values in via `define`, giving them final priority.
function readEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m?.[1] && m[2] !== undefined) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

const envLocal = readEnvLocal();
const v = (name: string) => JSON.stringify(envLocal[name] ?? "");

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": v("VITE_SUPABASE_URL"),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": v("VITE_SUPABASE_PUBLISHABLE_KEY"),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": v("VITE_SUPABASE_PROJECT_ID"),
    },
  },
});
