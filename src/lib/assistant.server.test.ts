import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_GATEWAY_ANTHROPIC_VERSION,
  ANTHROPIC_VERSION,
  ASSISTANT_GATEWAY_MODEL_DEFAULT,
  assistantModel,
  resolveAssistantAuth,
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

const base = {
  auth: { provider: "anthropic" as const, apiKey: "k" },
  sb,
  today: "2026-10-31",
  question: "quanto tenho?",
};

describe("resolveAssistantAuth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    for (const k of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_WORKSPACE_ID",
      "AI_GATEWAY_API_KEY",
      "VERCEL_OIDC_TOKEN",
      "ASSISTANT_MODEL",
    ])
      vi.stubEnv(k, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("prefere a chave da Anthropic quando existe", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk");
    vi.stubEnv("ANTHROPIC_WORKSPACE_ID", "w1");
    expect(resolveAssistantAuth("oidc")).toEqual({
      provider: "anthropic",
      apiKey: "sk",
      workspaceId: "w1",
    });
  });

  it("sem chave usa o token OIDC do pedido no AI Gateway", () => {
    expect(resolveAssistantAuth(" oidc ")).toEqual({ provider: "gateway", token: "oidc" });
  });

  it("a chave do Gateway passa à frente do OIDC; o OIDC do ambiente é o último recurso", () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "env-oidc");
    expect(resolveAssistantAuth(null)).toEqual({ provider: "gateway", token: "env-oidc" });
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw");
    expect(resolveAssistantAuth("oidc")).toEqual({ provider: "gateway", token: "gw" });
  });

  it("sem nada devolve null", () => {
    expect(resolveAssistantAuth(undefined)).toBeNull();
  });

  it("o modelo por omissão depende do fornecedor", () => {
    expect(assistantModel("anthropic")).toBe("claude-haiku-5-5");
    expect(assistantModel("gateway")).toBe(ASSISTANT_GATEWAY_MODEL_DEFAULT);
    vi.stubEnv("ASSISTANT_MODEL", "google/x");
    expect(assistantModel("gateway")).toBe("google/x");
  });
});

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
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(init.headers as Record<string, string>).not.toHaveProperty("anthropic-workspace-id");
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.messages).toEqual([{ role: "user", content: "quanto tenho?" }]);
  });

  it("envia o workspace quando configurado", async () => {
    const fetchImpl = vi.fn(async () => textReply("ok"));
    await runAssistant({
      ...base,
      auth: { provider: "anthropic", apiKey: "k", workspaceId: "wrkspc_123" },
      tools: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["anthropic-workspace-id"]).toBe("wrkspc_123");
  });

  it("no AI Gateway usa o endpoint, o Bearer e o modelo do Gateway", async () => {
    const fetchImpl = vi.fn(async () => textReply("ok"));
    await runAssistant({
      ...base,
      auth: { provider: "gateway", token: "oidc" },
      tools: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/messages");
    expect(headers["authorization"]).toBe("Bearer oidc");
    expect(headers["anthropic-version"]).toBe(AI_GATEWAY_ANTHROPIC_VERSION);
    expect(headers).not.toHaveProperty("x-api-key");
    expect(JSON.parse(init.body as string).model).toBe(ASSISTANT_GATEWAY_MODEL_DEFAULT);
  });

  it("explica quando o crédito do Gateway acabou", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 402 }));
    await expect(
      runAssistant({
        ...base,
        auth: { provider: "gateway", token: "oidc" },
        tools: [],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/crédito do AI Gateway/);
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
