import { useEffect, useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button, Card, TextInput } from "@/components/ui-bits";
import { InfoTip } from "@/components/info-tip";
import { formatNumber, parseNumberPt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CompanyAnalysis } from "@/lib/valuation/analyze";
import {
  ASSUMPTION_LABELS,
  PERCENT_ASSUMPTIONS,
  type AssumptionKey,
  type Assumptions,
} from "@/lib/valuation/assumptions";

/** Pressupostos visíveis conforme o tipo de empresa. */
function visibleKeys(a: CompanyAnalysis): AssumptionKey[] {
  const type = a.classification.type;
  const keys: AssumptionKey[] = ["riskFree", "matureErp", "crp", "beta"];
  if (type !== "financeira") {
    keys.push(
      "preTaxCostOfDebt",
      "marginalTax",
      "effectiveTax",
      "growth",
      "targetMargin",
      "salesToCapital",
    );
  }
  keys.push("terminalGrowth");
  if (a.ddm.dividend) keys.push("dividendGrowth");
  if (type === "reit") keys.push("capRate", "pAffoTarget", "maintenanceCapexPct");
  return keys;
}

const toText = (key: AssumptionKey, v: number) =>
  PERCENT_ASSUMPTIONS.has(key) ? formatNumber(v * 100, 2) : formatNumber(v, 2);

/** Limites de cada pressuposto (em fração para as percentagens). */
const BOUNDS: Partial<Record<AssumptionKey, [number, number]>> = {
  riskFree: [0, 0.2],
  matureErp: [0, 0.15],
  crp: [0, 0.3],
  beta: [0, 4],
  preTaxCostOfDebt: [0, 0.3],
  marginalTax: [0, 0.6],
  effectiveTax: [0, 0.6],
  growth: [-0.3, 0.8],
  targetMargin: [-0.5, 0.9],
  terminalGrowth: [-0.02, 0.05],
  salesToCapital: [0.1, 10],
  dividendGrowth: [-0.2, 0.3],
  capRate: [0.01, 0.2],
  pAffoTarget: [1, 60],
  maintenanceCapexPct: [0, 1],
};

export function AssumptionsPanel({
  analysis: a,
  overrides,
  onChange,
}: {
  analysis: CompanyAnalysis;
  overrides: Partial<Assumptions>;
  onChange: (next: Partial<Assumptions>) => void;
}) {
  const keys = visibleKeys(a);
  const [drafts, setDrafts] = useState<Partial<Record<AssumptionKey, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<AssumptionKey, string>>>({});
  // Os rascunhos seguem os valores atuais quando estes mudam por fora (repor).
  useEffect(() => setDrafts({}), [overrides]);

  const commit = (key: AssumptionKey) => {
    const text = drafts[key];
    if (text == null) return;
    const n = parseNumberPt(text);
    const value = PERCENT_ASSUMPTIONS.has(key) ? n / 100 : n;
    const [lo, hi] = BOUNDS[key] ?? [-Infinity, Infinity];
    if (!Number.isFinite(value) || value < lo || value > hi) {
      setErrors({ ...errors, [key]: "Valor fora do intervalo razoável." });
      return;
    }
    const nextErrors = { ...errors };
    delete nextErrors[key];
    setErrors(nextErrors);
    const next = { ...overrides };
    if (Math.abs(value - a.defaults[key]) < 1e-9) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const changed = Object.keys(overrides).length;
  return (
    <Card
      title="Pressupostos"
      icon={<SlidersHorizontal aria-hidden className="h-4 w-4 text-muted-foreground" />}
      description="Derivados dos dados da empresa, do Damodaran e do mercado. Altera qualquer um (em %, onde indicado) e todos os modelos recalculam no momento."
      action={
        changed > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => onChange({})}>
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            Repor {changed} {changed === 1 ? "alteração" : "alterações"}
          </Button>
        ) : null
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {keys.map((key) => {
          const isPct = PERCENT_ASSUMPTIONS.has(key);
          const current = a.assumptions[key];
          const overridden = key in overrides;
          return (
            <div
              key={key}
              className={cn(
                "rounded-lg border p-3",
                overridden ? "border-primary/50 bg-primary/5" : "border-border",
              )}
            >
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  {ASSUMPTION_LABELS[key]}
                  {isPct && " (%)"}
                  <InfoTip label={`De onde vem: ${ASSUMPTION_LABELS[key]}`}>{a.notes[key]}</InfoTip>
                </span>
                <TextInput
                  inputMode="decimal"
                  aria-label={`${ASSUMPTION_LABELS[key]}${isPct ? " (%)" : ""}`}
                  value={drafts[key] ?? toText(key, current)}
                  aria-invalid={errors[key] ? true : undefined}
                  onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })}
                  onBlur={() => commit(key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit(key);
                  }}
                />
              </label>
              <p
                className={cn(
                  "mt-1 text-[11px]",
                  errors[key] ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {errors[key] ??
                  (overridden
                    ? `Valor dos dados: ${toText(key, a.defaults[key])}${isPct ? " %" : ""}`
                    : "Valor dos dados")}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
