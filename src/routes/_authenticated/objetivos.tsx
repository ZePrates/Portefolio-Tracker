import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Flame, Scale } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  MetricCard,
  PageHeader,
  TextInput,
} from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { CLASS_COLOR } from "@/components/chart-kit";
import { usePrivateMode } from "@/components/private-mode";
import {
  getAllocation,
  getFireProgress,
  saveFireSettings,
  setAllocationTargets,
} from "@/lib/goals.functions";
import { formatEUR, formatNumber, formatPct, formatPp, parseNumberPt } from "@/lib/format";
import { FIRE_DEFAULTS, validateFire, type FireForm } from "@/lib/fire-form";
import type { AssetClass } from "@/lib/portfolio-types";

export const Route = createFileRoute("/_authenticated/objetivos")({
  head: () => ({
    meta: [
      { title: "Objetivos — Portefólio Tracker" },
      {
        name: "description",
        content: "Independência financeira (FIRE) e alocação-alvo por classe de ativo.",
      },
    ],
  }),
  component: ObjetivosPage,
});

function ObjetivosPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Objetivos"
        subtitle="Independência financeira (FIRE) e alocação-alvo por classe de ativo."
      />
      <FireSection />
      <AllocationSection />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FIRE                                                                */
/* ------------------------------------------------------------------ */

function monthLong(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return yyyymm;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString("pt-PT", {
    month: "long",
    year: "numeric",
  });
}

function FireSection() {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const fetchFire = useServerFn(getFireProgress);
  const saveFn = useServerFn(saveFireSettings);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["fire"],
    queryFn: () => fetchFire(),
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FireForm>(FIRE_DEFAULTS);
  const [touched, setTouched] = useState<Partial<Record<keyof FireForm, boolean>>>({});
  const [saving, setSaving] = useState(false);

  // Ao abrir a edição, parte dos valores guardados (ou dos valores por defeito).
  const startEditing = () => {
    const s = data?.settings;
    setForm(
      s
        ? {
            annualExpenses: formatNumber(s.annualExpenses, 0).replace(/\s/g, ""),
            safeWithdrawalRate: String(s.safeWithdrawalRate).replace(".", ","),
            monthlyContribution: String(s.monthlyContribution).replace(".", ","),
            expectedReturnPct: String(s.expectedReturnPct).replace(".", ","),
            inflationPct: String(s.inflationPct).replace(".", ","),
          }
        : FIRE_DEFAULTS,
    );
    setTouched({});
    setEditing(true);
  };

  const errors = useMemo(() => validateFire(form), [form]);
  const showError = (k: keyof FireForm) => (touched[k] ? errors[k] : undefined);

  const set = (k: keyof FireForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setTouched((t) => ({ ...t, [k]: true }));
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setTouched({
      annualExpenses: true,
      safeWithdrawalRate: true,
      monthlyContribution: true,
      expectedReturnPct: true,
      inflationPct: true,
    });
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      await saveFn({
        data: {
          annualExpenses: parseNumberPt(form.annualExpenses),
          safeWithdrawalRate: parseNumberPt(form.safeWithdrawalRate),
          monthlyContribution: parseNumberPt(form.monthlyContribution),
          expectedReturnPct: parseNumberPt(form.expectedReturnPct),
          inflationPct: parseNumberPt(form.inflationPct),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["fire"] });
      toast.success("Objetivo FIRE guardado.");
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível guardar o objetivo.");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card title="Progresso FIRE" icon={<Flame aria-hidden className="h-4 w-4 text-primary" />}>
        <div aria-busy="true" aria-label="A carregar" className="space-y-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </Card>
    );
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  const progress = data?.progress;
  const showForm = editing || !data?.settings;

  return (
    <Card
      title="Progresso FIRE"
      icon={<Flame aria-hidden className="h-4 w-4 text-primary" />}
      description="O número FIRE é o capital que sustenta as tuas despesas com a taxa de levantamento escolhida (regra dos 25× com 4 %)."
      action={
        !showForm ? (
          <Button variant="ghost" size="sm" onClick={startEditing}>
            Editar
          </Button>
        ) : undefined
      }
    >
      {showForm ? (
        <form onSubmit={save} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Despesas anuais (€)"
              required
              error={showError("annualExpenses")}
              hint="O que gastas por ano, em euros de hoje."
            >
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={form.annualExpenses}
                onChange={set("annualExpenses")}
                placeholder="ex.: 24 000"
              />
            </Field>
            <Field
              label="Taxa de levantamento segura (%)"
              required
              error={showError("safeWithdrawalRate")}
            >
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={form.safeWithdrawalRate}
                onChange={set("safeWithdrawalRate")}
              />
            </Field>
            <Field
              label="Aporte mensal (€)"
              error={showError("monthlyContribution")}
              hint="Quanto pensas investir por mês."
            >
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={form.monthlyContribution}
                onChange={set("monthlyContribution")}
              />
            </Field>
            <Field label="Retorno anual esperado (%)" error={showError("expectedReturnPct")}>
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={form.expectedReturnPct}
                onChange={set("expectedReturnPct")}
              />
            </Field>
            <Field label="Inflação anual esperada (%)" error={showError("inflationPct")}>
              <TextInput
                inputMode="decimal"
                autoComplete="off"
                value={form.inflationPct}
                onChange={set("inflationPct")}
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={saving}>
              Guardar objetivo
            </Button>
            {data?.settings && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      ) : (
        progress && (
          <div className="space-y-5">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="num text-3xl font-bold">
                  {formatPct(progress.progressPct, 1, hidden)}
                </p>
                <p className="text-xs text-muted-foreground">do número FIRE</p>
              </div>
              <div
                role="progressbar"
                aria-label="Progresso FIRE"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={hidden ? undefined : Math.min(100, Math.round(progress.progressPct))}
                className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: hidden ? "0%" : `${Math.min(100, progress.progressPct)}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
              <MetricCard label="Número FIRE" value={formatEUR(progress.fireNumber, hidden)} />
              <MetricCard label="Falta" value={formatEUR(progress.remaining, hidden)} />
              <MetricCard
                label="Despesas cobertas"
                value={formatPct(progress.passiveCoveragePct, 1, hidden)}
                sub="dividendos líquidos (12 m) ÷ despesas"
              />
              <MetricCard
                label="Previsão"
                value={
                  progress.fireMonth
                    ? monthLong(progress.fireMonth)
                    : progress.yearsToFire === 0
                      ? "Já atingido"
                      : "Fora de alcance"
                }
                sub={
                  progress.yearsToFire
                    ? `${formatNumber(progress.yearsToFire, 1)} anos · retorno real ${formatPct(progress.realReturnPct, 1)}`
                    : `retorno real ${formatPct(progress.realReturnPct, 1)}`
                }
              />
            </div>
          </div>
        )
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Alocação-alvo                                                       */
/* ------------------------------------------------------------------ */

function AllocationSection() {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const fetchAllocation = useServerFn(getAllocation);
  const saveFn = useServerFn(setAllocationTargets);

  const [contributionText, setContributionText] = useState("");
  const contribution = Math.max(0, parseNumberPt(contributionText) || 0);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["allocation", "class", contribution],
    queryFn: () => fetchAllocation({ data: { scope: "class", contribution } }),
  });

  const [targets, setTargets] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sincroniza o editor com o que está guardado (só se o utilizador não estiver a editar).
  useEffect(() => {
    if (!data || dirty) return;
    setTargets(
      Object.fromEntries(
        data.drift.rows
          .filter((r) => r.targetPct > 0)
          .map((r) => [r.key, formatNumber(r.targetPct, 1).replace(/\s/g, "")]),
      ),
    );
  }, [data, dirty]);

  const sum = Object.values(targets).reduce((s, v) => s + (parseNumberPt(v) || 0), 0);
  const overLimit = sum > 100.0001;

  const save = async () => {
    const list = Object.entries(targets)
      .map(([key, v]) => ({ key, targetPct: parseNumberPt(v) }))
      .filter((t) => Number.isFinite(t.targetPct) && t.targetPct > 0);
    setSaving(true);
    try {
      await saveFn({ data: { scope: "class", targets: list } });
      await queryClient.invalidateQueries({ queryKey: ["allocation"] });
      setDirty(false);
      toast.success(list.length > 0 ? "Alocação-alvo guardada." : "Alvos removidos.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível guardar os alvos.");
    } finally {
      setSaving(false);
    }
  };

  const icon = <Scale aria-hidden className="h-4 w-4 text-primary" />;
  if (isLoading) {
    return (
      <Card title="Alocação-alvo" icon={icon}>
        <div aria-busy="true" aria-label="A carregar" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </Card>
    );
  }
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const hasTargets = data.drift.targetSum > 0;

  return (
    <Card
      title="Alocação-alvo"
      icon={icon}
      description="Opcional: define o peso que queres em cada classe. Não é obrigatório e não há valores por defeito."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">Peso atual, alvo e desvio por classe de ativo</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                Classe
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Atual
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Alvo (%)
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Desvio
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">
                Face ao alvo
              </th>
            </tr>
          </thead>
          <tbody>
            {data.drift.rows.map((r) => {
              const raw = targets[r.key] ?? "";
              const has = (parseNumberPt(raw) || 0) > 0;
              return (
                <tr key={r.key} className="border-b border-border/60">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          background: CLASS_COLOR[r.key as AssetClass] ?? "var(--color-chart-8)",
                        }}
                      />
                      {r.label}
                    </span>
                  </th>
                  <td className="num px-3 py-2 text-right">{formatPct(r.currentPct, 1, hidden)}</td>
                  <td className="px-3 py-2 text-right">
                    <TextInput
                      aria-label={`Alvo para ${r.label} (%)`}
                      inputMode="decimal"
                      autoComplete="off"
                      className="ml-auto w-20 text-right"
                      value={raw}
                      onChange={(e) => {
                        setDirty(true);
                        setTargets((t) => ({ ...t, [r.key]: e.target.value }));
                      }}
                    />
                  </td>
                  <td className="num px-3 py-2 text-right">
                    {has && hasTargets ? formatPp(r.driftPct, 1, hidden) : "—"}
                  </td>
                  <td className="num py-2 pl-3 text-right">
                    {has && hasTargets ? (
                      Math.abs(r.driftPct) >= 5 ? (
                        <Badge tone="warn">
                          {r.driftValue > 0 ? "Acima: " : "Abaixo: "}
                          {formatEUR(Math.abs(r.driftValue), hidden)}
                        </Badge>
                      ) : (
                        <Badge>No alvo</Badge>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Badge tone={overLimit ? "loss" : sum === 100 ? "gain" : "neutral"}>
          Soma dos alvos: {formatPct(sum, 1)}
        </Badge>
        {overLimit && (
          <p role="alert" className="text-xs text-destructive">
            A soma dos alvos não pode passar de 100 %.
          </p>
        )}
        <Button className="ml-auto" onClick={save} loading={saving} disabled={!dirty || overLimit}>
          Guardar alvos
        </Button>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Onde investir o próximo aporte</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Reparte o valor pelas classes abaixo do alvo, sem vender nada (evita realizar
          mais-valias).
        </p>
        <div className="mt-3 max-w-xs">
          <Field label="Aporte (€)">
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              value={contributionText}
              onChange={(e) => setContributionText(e.target.value)}
              placeholder="ex.: 500"
            />
          </Field>
        </div>
        {contribution > 0 && !hasTargets && (
          <p className="mt-3 text-sm text-muted-foreground">
            Define e guarda os alvos acima para veres a sugestão.
          </p>
        )}
        {contribution > 0 && hasTargets && (
          <ul className="mt-3 space-y-1.5" aria-live="polite">
            {data.contribution.length === 0 ? (
              <li className="text-sm text-muted-foreground">Sem sugestão para este aporte.</li>
            ) : (
              data.contribution.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
                  <span>{s.label}</span>
                  <span className="num font-medium">{formatEUR(s.amount, hidden)}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </Card>
  );
}
