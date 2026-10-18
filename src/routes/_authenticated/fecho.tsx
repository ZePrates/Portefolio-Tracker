import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowRight, Circle, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  PageHeader,
  SelectInput,
} from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrivateMode } from "@/components/private-mode";
import { privateEUR } from "@/components/private-value";
import { todayLisbon } from "@/lib/dates";
import { getMonthClose, setMonthCloseConfirmed } from "@/lib/month-close.functions";
import { defaultCloseMonth, shiftMonth, type MonthCloseStep } from "@/lib/month-close";

const DESCRIPTION =
  "Rotina mensal: extrato da XTB, dividendos, compras da Elementum e relatório da Scramble. A XTB e os dividendos ficam feitos sozinhos quando os dados chegam; na Elementum e na Scramble confirmas tu que está tudo registado.";

export const Route = createFileRoute("/_authenticated/fecho")({
  head: () => ({
    meta: [
      { title: "Fecho do mês — Portefólio Tracker" },
      { name: "description", content: DESCRIPTION },
    ],
  }),
  component: MonthClosePage,
});

function monthLong(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
}

function MonthClosePage() {
  const { hidden } = usePrivateMode();
  const fetchClose = useServerFn(getMonthClose);
  const today = todayLisbon();
  const current = today.slice(0, 7);
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => shiftMonth(current, -i)),
    [current],
  );
  const [month, setMonth] = useState(() => defaultCloseMonth(today));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["month-close", month],
    queryFn: () => fetchClose({ data: { month } }),
  });

  const queryClient = useQueryClient();
  const confirmFn = useServerFn(setMonthCloseConfirmed);
  const [saving, setSaving] = useState<string | null>(null);
  const setConfirmed = async (step: "elementum" | "scramble", confirmed: boolean) => {
    setSaving(step);
    try {
      await confirmFn({ data: { month, step, confirmed } });
      // O lembrete do dashboard depende da mesma confirmação.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["month-close", month] }),
        queryClient.invalidateQueries({ queryKey: ["data-quality"] }),
      ]);
    } catch {
      toast.error("Não foi possível guardar a confirmação.");
    } finally {
      setSaving(null);
    }
  };

  const total = data?.steps.length ?? 0;
  const allDone = !!data && total > 0 && data.doneCount === total;

  return (
    <div className="space-y-6">
      <PageHeader title="Fecho do mês" subtitle={DESCRIPTION} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Mês" className="w-56">
          <SelectInput value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLong(m)}
              </option>
            ))}
          </SelectInput>
        </Field>
        {data && (
          <div className="flex items-center gap-2 text-sm">
            <Badge tone={allDone ? "gain" : "warn"}>
              {allDone ? "Mês fechado" : `${data.doneCount} de ${total} passos feitos`}
            </Badge>
            <span className="text-muted-foreground">
              Dividendos líquidos: {privateEUR(data.dividendsNet, hidden)}
            </span>
          </div>
        )}
      </div>

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div aria-busy="true" aria-label="A carregar" className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <ol className="space-y-3">
          {data.steps.map((s, i) => (
            <li key={s.key}>
              <StepCard
                step={s}
                index={i + 1}
                saving={saving === s.key}
                onConfirm={(confirmed) =>
                  void setConfirmed(s.key as "elementum" | "scramble", confirmed)
                }
              />
            </li>
          ))}
        </ol>
      )}
      {month === current && !allDone && (
        <p className="text-xs text-muted-foreground">
          O mês ainda não acabou: os passos em falta podem ser só o que ainda não aconteceu.
        </p>
      )}
    </div>
  );
}

function StepCard({
  step,
  index,
  saving,
  onConfirm,
}: {
  step: MonthCloseStep;
  index: number;
  saving: boolean;
  onConfirm: (confirmed: boolean) => void;
}) {
  return (
    <Card className={step.done ? "opacity-80" : undefined}>
      <div className="flex items-start gap-3">
        {step.done ? (
          <CircleCheck aria-label="Feito" className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        ) : (
          <Circle
            aria-label="Por fazer"
            className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">
            {index}. {step.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{step.summary}</p>
          {step.pending.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-sm">
              {step.pending.slice(0, 8).map((p) => (
                <li key={p} className="num">
                  {p}
                </li>
              ))}
              {step.pending.length > 8 && (
                <li className="text-muted-foreground">e mais {step.pending.length - 8}…</li>
              )}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {step.confirmable && (
            <Button
              variant={step.confirmed ? "ghost" : "primary"}
              size="sm"
              disabled={saving}
              onClick={() => onConfirm(!step.confirmed)}
            >
              {step.confirmed ? "Reabrir" : "Está tudo registado"}
            </Button>
          )}
          <Link to={step.href}>
            <Button variant={step.done ? "ghost" : "outline"} size="sm">
              {step.action}
              <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
