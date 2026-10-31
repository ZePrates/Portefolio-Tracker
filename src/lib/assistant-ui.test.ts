import { describe, expect, it } from "vitest";
import { historyToSend, suggestionsFor, type PanelMessage } from "./assistant-ui";

describe("suggestionsFor", () => {
  it("devolve sugestões da página e, nas outras, as gerais", () => {
    expect(suggestionsFor("/metais")[0]).toMatch(/gramas/);
    expect(suggestionsFor("/dividendos/2026")[0]).toMatch(/dividendos/);
    expect(suggestionsFor("/")).toEqual(suggestionsFor("/pagina-desconhecida"));
  });
  it("não confunde prefixos parecidos", () => {
    expect(suggestionsFor("/metaisx")).toEqual(suggestionsFor("/"));
  });
});

describe("historyToSend", () => {
  const msgs: PanelMessage[] = [
    { id: 1, role: "user", content: "olá" },
    { id: 2, role: "assistant", content: "erro", error: true },
    { id: 3, role: "user", content: "e agora?" },
    { id: 4, role: "assistant", content: "resposta" },
  ];
  it("ignora respostas de erro", () => {
    expect(historyToSend(msgs).map((m) => m.content)).toEqual(["olá", "e agora?", "resposta"]);
  });
  it("limita ao máximo de mensagens", () => {
    expect(historyToSend(msgs, 2)).toHaveLength(2);
  });
});
