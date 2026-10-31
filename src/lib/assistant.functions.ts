import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { todayLisbon } from "@/lib/dates";
import { assistantTools } from "@/lib/assistant-tools";
import { anthropicKey, checkRateLimit, runAssistant } from "@/lib/assistant.server";

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),
});

/**
 * Pergunta ao assistente. O histórico é o da sessão do browser (não é guardado):
 * o cliente envia as últimas trocas em cada pedido.
 */
export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        question: z.string().trim().min(2, "Escreve uma pergunta.").max(600),
        page: z.string().max(80).nullish(),
        history: z.array(turnSchema).max(24).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const apiKey = anthropicKey();
    if (!apiKey) {
      throw new Error(
        "O assistente não está configurado: falta a variável ANTHROPIC_API_KEY na Vercel (Production e Preview).",
      );
    }
    if (!checkRateLimit(context.userId)) {
      throw new Error("Atingiste o limite de perguntas por hora. Tenta de novo mais tarde.");
    }
    return runAssistant({
      apiKey,
      sb: context.supabase,
      tools: assistantTools,
      question: data.question,
      history: data.history,
      page: data.page ?? null,
      today: todayLisbon(),
    });
  });
