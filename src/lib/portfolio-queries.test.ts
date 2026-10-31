import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { PORTFOLIO_QUERY_KEYS, invalidatePortfolio } from "@/lib/portfolio-queries";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "ui" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("invalidatePortfolio", () => {
  it("marca como desatualizadas todas as queries da carteira, incluindo as com parâmetros", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["assets"], []);
    qc.setQueryData(["position", "abc"], {});
    qc.setQueryData(["dividend-calendar", 12], {});
    qc.setQueryData(["outra-coisa"], 1);
    await invalidatePortfolio(qc);
    expect(qc.getQueryState(["assets"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["position", "abc"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["dividend-calendar", 12])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["outra-coisa"])?.isInvalidated).toBe(false);
  });

  it("cobre todas as chaves de query usadas pelos ecrãs", () => {
    const keys = new Set<string>();
    for (const file of sourceFiles(join(__dirname, ".."))) {
      for (const m of readFileSync(file, "utf8").matchAll(/queryKey: \["([a-z-]+)"/g)) {
        keys.add(m[1]!);
      }
    }
    // Uma query nova que não dependa da carteira entra aqui, com o motivo.
    const unrelated = new Set<string>([
      // Estado das notificações push do dispositivo: não depende dos dados da carteira.
      "push-status",
    ]);
    const known = new Set<string>(PORTFOLIO_QUERY_KEYS);
    const missing = [...keys].filter((k) => !known.has(k) && !unrelated.has(k));
    expect(keys.size).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });
});
