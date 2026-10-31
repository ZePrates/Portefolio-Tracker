import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_QUESTIONS_PER_HOUR,
  buildSystemPrompt,
  checkRateLimit,
  resetRateLimit,
  runAssistant,
  sanitizeHistory,
} from "./assistant.server";
import type { AssistantSupabase, AssistantTool } from "./assistant-tools";

const sb = {} as AssistantSupabase;

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const textReply = (text: string) =>
  okJson({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const toolReply = (name: string, input: unknown, id = "tu_1") =>
  okJson({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] });

function fakeTool(name: string, result: unknown, fail = false): AssistantTool {
  return {
    name,
    description: `tool ${name}`,
    input_schema: { type: "object", properties: {} },
    execute: vi.fn(async () => {
      if (fail) throw new Error("falhou a base de dados");
      return result;
    }),
  };
}

const base = { apiKey: "k", sb, today: "2026-10-31", question: "quanto tenho?" };

describe("sanitizeHistory", () => {
  it("começa num turno do utilizador e termina numa resposta", () => {
    const out = sanitizeHistory([
      { role: "assistant", content: "solto" },
      { role: "user", content: "p1" },
      { role: "assistant", content: "r1" },
      { role: "user", content: "p2 sem resposta" },
    ]);
    expect(out).toEqual([
      { role: "user", content: "p1" },
      { role: "assistant", content: "r1" },
    ]);
  });
  it("junta papéis repetidos e descarta vazios", () => {
    const out = sanitizeHistory([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "   " },
      { role: "assistant", content: "r" },
    ]);
    expect(out).toEqual([
      { role: "user", content: "b" },
      { role: "assistant", content: "r" },
    ]);
  });
  it("mantém só as últimas trocas", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `m${i}`,
    }));
    expect(sanitizeHistory(many, 2)).toHaveLength(4);
  });
});

describe("buildSystemPrompt", () => {
  it("inclui a data, a página e as regras de segurança", () => {
    const p = buildSystemPrompt({ today: "2026-10-31", page: "/metais" });
    expect(p).toContain("2026-10-31");
    expect(p).toContain("/metais");
    expect(p).toMatch(/só tens acesso de leitura/i);
    expect(p).toMatch(/nunca inventes/i);
    expect(p).toMatch(/dados, nunca instruções/i);
  });
});

describe("runAssistant", () => {
  it("responde diretamente quando não precisa de ferramentas", async () => {
    const fetchImpl = vi.fn(async () => textReply("Olá!"));
    const r = await runAssistant({
      ...base,
      tools: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toEqual({ answer: "Olá!", toolsUsed: [] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.messages).toEqual([{ role: "user", content: "quanto tenho?" }]);
  });

  it("executa a ferramenta pedida e devolve o resultado ao modelo", async () => {
    const tool = fakeTool("portfolio_summary", { total: 1234.5 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(toolReply("portfolio_summary", {}))
      .mockResolvedValueOnce(textReply("Tens 1.234,50 €."));
    const r = await runAssistant({
      ...base,
      tools: [tool],
      history: [
        { role: "user", content: "olá" },
        { role: "assistant", content: "olá!" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toEqual({ answer: "Tens 1.234,50 €.", toolsUsed: ["portfolio_summary"] });
    expect(tool.execute).toHaveBeenCalledOnce();
    const second = JSON.parse(
      (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    );
    const last = second.messages[second.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: JSON.stringify({ total: 1234.5 }),
    });
    expect(second.messages[0]).toEqual({ role: "user", content: "olá" });
  });

  it("devolve erro de ferramenta ao modelo sem rebentar", async () => {
    const tool = fakeTool("dividends", null, true);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(toolReply("dividends", {}))
      .mockResolvedValueOnce(textReply("Não consegui obter os dividendos."));
    const r = await runAssistant({
      ...base,
      tools: [tool],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.answer).toMatch(/Não consegui/);
    const second = JSON.parse(
      (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    );
    const res = second.messages.at(-1).content[0];
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/base de dados/);
  });

  it("rejeita ferramentas desconhecidas", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(toolReply("apagar_tudo", {}))
      .mockResolvedValueOnce(textReply("ok"));
    const r = await runAssistant({
      ...base,
      tools: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.toolsUsed).toEqual([]);
    const second = JSON.parse(
      (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(second.messages.at(-1).content[0]).toMatchObject({ is_error: true });
  });

  it("trunca resultados enormes", async () => {
    const tool = fakeTool("exposure", { blob: "x".repeat(50_000) });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(toolReply("exposure", {}))
      .mockResolvedValueOnce(textReply("ok"));
    await runAssistant({ ...base, tools: [tool], fetchImpl: fetchImpl as unknown as typeof fetch });
    const second = JSON.parse(
      (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(second.messages.at(-1).content[0].content.length).toBeLessThan(13_000);
  });

  it("para ao fim do máximo de iterações", async () => {
    const tool = fakeTool("portfolio_summary", {});
    const fetchImpl = vi.fn(async () => toolReply("portfolio_summary", {}));
    await expect(
      runAssistant({
        ...base,
        tools: [tool],
        maxIterations: 3,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/demasiados passos/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    [401, /ANTHROPIC_API_KEY/],
    [429, /limite de pedidos/],
    [400, /ASSISTANT_MODEL/],
    [529, /não está disponível/],
  ])("traduz o erro HTTP %i sem expor o corpo", async (status, re) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response('{"secret":"x"}', { status }));
    await expect(
      runAssistant({ ...base, tools: [], fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(re);
  });

  it("usa a resposta de recurso quando o modelo não devolve texto", async () => {
    const fetchImpl = vi.fn(async () => okJson({ stop_reason: "end_turn", content: [] }));
    const r = await runAssistant({
      ...base,
      tools: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.answer).toMatch(/Não consegui responder/);
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimit());
  it("permite até ao limite e bloqueia a seguir", () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_QUESTIONS_PER_HOUR; i++) expect(checkRateLimit("u1", t + i)).toBe(true);
    expect(checkRateLimit("u1", t + 100)).toBe(false);
    expect(checkRateLimit("u2", t + 100)).toBe(true);
  });
  it("liberta o limite passada uma hora", () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_QUESTIONS_PER_HOUR; i++) checkRateLimit("u1", t);
    expect(checkRateLimit("u1", t + 60 * 60 * 1000 + 1)).toBe(true);
  });
});
