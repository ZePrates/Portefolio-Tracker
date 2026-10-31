import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { EyeOff, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { usePrivateMode } from "@/components/private-mode";
import { IconButton } from "@/components/ui-bits";
import { askAssistant } from "@/lib/assistant.functions";
import { historyToSend, suggestionsFor, type PanelMessage } from "@/lib/assistant-ui";
import { cn } from "@/lib/utils";

/**
 * Assistente de perguntas sobre a carteira: botão flutuante em toda a área
 * autenticada (Ctrl/⌘+J). A conversa vive só nesta sessão do browser.
 */
export function AssistantPanel() {
  const { hidden } = usePrivateMode();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ask = useServerFn(askAssistant);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [draft, setDraft] = useState("");
  const nextId = useRef(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: (vars: { question: string; history: ReturnType<typeof historyToSend> }) =>
      ask({ data: { question: vars.question, page: pathname, history: vars.history } }),
    onSuccess: (res) =>
      setMessages((m) => [...m, { id: nextId.current++, role: "assistant", content: res.answer }]),
    onError: (e) =>
      setMessages((m) => [
        ...m,
        {
          id: nextId.current++,
          role: "assistant",
          error: true,
          content: e instanceof Error ? e.message : "Não foi possível obter resposta.",
        },
      ]),
  });
  const busy = mutation.isPending;

  const send = useCallback(
    (text: string) => {
      const question = text.trim();
      if (question.length < 2 || busy || hidden) return;
      const history = historyToSend(messages);
      setMessages((m) => [...m, { id: nextId.current++, role: "user", content: question }]);
      setDraft("");
      mutation.mutate({ question, history });
    },
    [busy, hidden, messages, mutation],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open]);

  const suggestions = suggestionsFor(pathname);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir o assistente (Ctrl/⌘+J)"
          title="Assistente (Ctrl/⌘+J)"
          className="fixed bottom-20 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:bottom-6 lg:right-6"
        >
          <Sparkles aria-hidden className="h-5 w-5" />
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Assistente"
          className="fixed inset-x-2 bottom-20 z-50 flex max-h-[min(36rem,calc(100dvh-6rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-[26rem]"
        >
          <header className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Sparkles aria-hidden className="h-4 w-4 text-primary" />
            <h2 className="flex-1 text-sm font-semibold">Assistente</h2>
            {messages.length > 0 && (
              <IconButton
                label="Nova conversa"
                onClick={() => setMessages([])}
                disabled={busy}
                className="h-8 w-8 sm:h-8 sm:w-8"
              >
                <RotateCcw aria-hidden className="h-4 w-4" />
              </IconButton>
            )}
            <IconButton
              label="Fechar (Esc)"
              onClick={() => setOpen(false)}
              className="h-8 w-8 sm:h-8 sm:w-8"
            >
              <X aria-hidden className="h-4 w-4" />
            </IconButton>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm" aria-live="polite">
            {hidden ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <EyeOff aria-hidden className="h-6 w-6" />
                <p>O assistente está desativado em modo privado.</p>
                <p className="text-xs">Carrega em «p» para mostrar os valores e voltar a usá-lo.</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  Pergunta-me sobre a tua carteira: valores, dividendos, exposição, metais…
                </p>
                <ul className="space-y-1.5">
                  {suggestions.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => send(s)}
                        className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" && "justify-end")}>
                  <p
                    className={cn(
                      "max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : m.error
                          ? "border border-destructive/40 bg-destructive/10 text-destructive"
                          : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {m.content}
                  </p>
                </div>
              ))
            )}
            {busy && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                <span>A consultar os teus dados…</span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="border-t border-border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                rows={1}
                maxLength={600}
                disabled={hidden}
                placeholder="Escreve a tua pergunta…"
                aria-label="Pergunta ao assistente"
                className="max-h-28 min-h-10 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60 sm:text-sm"
              />
              <button
                type="submit"
                disabled={busy || hidden || draft.trim().length < 2}
                aria-label="Enviar"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
              Respostas a partir dos teus dados; confirma os valores importantes. Não é
              aconselhamento financeiro nem fiscal.
            </p>
          </form>
        </section>
      )}
    </>
  );
}
