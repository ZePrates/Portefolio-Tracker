import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChartColumn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button, TextInput, Field } from "@/components/ui-bits";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Portefólio Tracker" },
      {
        name: "description",
        content: "Inicia sessão no Portefólio Tracker para gerir os teus investimentos.",
      },
      { property: "og:title", content: "Entrar — Portefólio Tracker" },
      {
        property: "og:description",
        content: "Inicia sessão no Portefólio Tracker para gerir os teus investimentos.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setMessage("Conta criada! Verifica o teu email para confirmar o registo.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocorreu um erro.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <ChartColumn className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="mt-4 text-2xl font-bold">Portefólio Tracker</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin" ? "Inicia sessão para continuar" : "Cria a tua conta"}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <TextInput
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="o.teu@email.com"
              />
            </Field>
            <Field label="Palavra-passe">
              <TextInput
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {message && <p className="text-sm text-success">{message}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "A processar…" : mode === "signin" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            {mode === "signin" ? "Ainda não tens conta?" : "Já tens conta?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
                setMessage(null);
              }}
              className="font-medium text-primary hover:underline"
            >
              {mode === "signin" ? "Criar conta" : "Entrar"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
