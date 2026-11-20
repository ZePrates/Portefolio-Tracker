/** Peças partilhadas da página de avaliação: passos de cálculo, indicadores e etiquetas. */

import type { ReactNode } from "react";
import { Badge } from "@/components/ui-bits";
import { InfoTip } from "@/components/info-tip";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Verdict } from "@/lib/valuation/analyze";
import { VERDICT_LABELS } from "@/lib/valuation/analyze";
import { isNum } from "@/lib/valuation/stats";
import { EMPTY, scoreTone } from "@/components/valuation/format";

export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <Badge>Sem valor justo</Badge>;
  const tone = verdict === "subavaliada" ? "gain" : verdict === "sobreavaliada" ? "loss" : "warn";
  return <Badge tone={tone}>{VERDICT_LABELS[verdict]}</Badge>;
}

export function ScorePill({
  score,
  max = 100,
  label,
}: {
  score: number | null;
  max?: number;
  label: string;
}) {
  const tone = scoreTone(isNum(score) ? (score / max) * 100 : null);
  return (
    <span
      className={cn(
        "num inline-flex items-baseline gap-1 rounded-lg border px-2.5 py-1 text-sm font-semibold",
        tone === "positive" && "border-success/40 text-success",
        tone === "negative" && "border-destructive/40 text-destructive",
        tone === "default" && "border-border",
      )}
      aria-label={`${label}: ${isNum(score) ? formatNumber(score, 0) : "sem dados"} em ${max}`}
    >
      {isNum(score) ? formatNumber(score, max === 10 ? 1 : 0) : EMPTY}
      <span className="text-[11px] font-normal text-muted-foreground">/{max}</span>
    </span>
  );
}

export interface StepRow {
  label: ReactNode;
  formula?: ReactNode;
  value: ReactNode;
  strong?: boolean;
}

/** Cálculo explicado passo a passo: rótulo, fórmula e valor. */
export function StepList({ rows, className }: { rows: StepRow[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-border rounded-lg border border-border", className)}>
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            "flex items-start justify-between gap-3 px-3 py-2",
            r.strong && "bg-secondary/60",
          )}
        >
          <dt className="min-w-0 text-[13px]">
            <span className={cn(r.strong && "font-semibold")}>{r.label}</span>
            {r.formula && (
              <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{r.formula}</span>
            )}
          </dt>
          <dd className={cn("num shrink-0 text-right text-[13px]", r.strong && "font-semibold")}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Indicador compacto com explicação opcional. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "positive" | "negative" | "default";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border px-3 py-2.5">
      <p className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
        <span className="truncate">{label}</span>
        {hint && <InfoTip label={`Sobre ${label}`}>{hint}</InfoTip>}
      </p>
      <p
        className={cn(
          "num mt-1 text-[15px] font-semibold",
          tone === "positive" && "text-success",
          tone === "negative" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Texto explicativo de uma secção. */
export function Explainer({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>;
}

export function PassMark({ pass }: { pass: boolean | null }) {
  if (pass === null)
    return (
      <span className="text-muted-foreground" aria-label="Sem dados">
        —
      </span>
    );
  return pass ? (
    <span className="font-semibold text-success" aria-label="Cumpre">
      ✓
    </span>
  ) : (
    <span className="font-semibold text-destructive" aria-label="Não cumpre">
      ✗
    </span>
  );
}

/** Tabela simples e acessível (cabeçalho fixo à esquerda nas tabelas largas). */
export function SimpleTable({
  head,
  rows,
  className,
  firstColWide,
}: {
  head: ReactNode[];
  rows: ReactNode[][];
  className?: string;
  firstColWide?: boolean;
}) {
  return (
    <div className={cn("-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", className)}>
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11.5px] text-muted-foreground">
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  "px-2 py-2 font-medium",
                  i > 0 && "text-right",
                  i === 0 && firstColWide && "min-w-44",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-border/60 last:border-0">
              {r.map((c, ci) =>
                ci === 0 ? (
                  <th key={ci} scope="row" className="px-2 py-1.5 text-left font-normal">
                    {c}
                  </th>
                ) : (
                  <td key={ci} className="num px-2 py-1.5 text-right">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
