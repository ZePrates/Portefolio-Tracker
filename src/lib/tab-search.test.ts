import { describe, expect, it } from "vitest";
import { tabSearch } from "@/lib/tab-search";

describe("tabSearch", () => {
  const parse = tabSearch(["fire", "alocacao", "projecoes"] as const);

  it("aceita separadores conhecidos", () => {
    expect(parse({ tab: "projecoes" })).toEqual({ tab: "projecoes" });
  });

  it("omite o primeiro separador (é o de omissão) e ignora valores desconhecidos", () => {
    expect(parse({ tab: "fire" })).toEqual({});
    expect(parse({ tab: "nada" })).toEqual({});
    expect(parse({ tab: 3 })).toEqual({});
    expect(parse({})).toEqual({});
  });
});
