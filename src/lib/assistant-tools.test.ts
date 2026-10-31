import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("ferramentas do assistente", () => {
  const src = read("src/lib/assistant-tools.ts");

  it("são só de leitura: nenhuma escrita na base de dados", () => {
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(src).not.toMatch(/createServerFn/);
  });

  it("não obtêm dados financeiros por IA nem fazem pedidos externos", () => {
    expect(src).not.toMatch(/fetch\(|anthropic|openai|gemini/i);
  });

  it("cada ferramenta tem nome único e é registada na lista", () => {
    const names = [...src.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(8);
    expect(new Set(names).size).toBe(names.length);
    const listed = src.slice(src.indexOf("export const assistantTools"));
    for (const n of names) {
      const varName = `${n.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}Tool`;
      const alt = new RegExp(`\\b(${varName}|${n.split("_")[0]}\\w*Tool)\\b`);
      expect(listed).toMatch(alt);
    }
  });
});

describe("isolamento da IA", () => {
  it("só a chave e o ciclo do assistente falam com a Anthropic", () => {
    const server = read("src/lib/assistant.server.ts");
    expect(server).toMatch(/api\.anthropic\.com/);
    for (const f of [
      "src/lib/assistant-data.ts",
      "src/lib/assistant-ui.ts",
      "src/components/assistant-panel.tsx",
    ]) {
      expect(read(f)).not.toMatch(/anthropic|ANTHROPIC_API_KEY|x-api-key/i);
    }
  });

  it("o browser nunca importa módulos .server", () => {
    expect(read("src/components/assistant-panel.tsx")).not.toMatch(/\.server"/);
    expect(read("src/lib/assistant-ui.ts")).not.toMatch(/\.server"/);
  });
});
