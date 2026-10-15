import { useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui-bits";
import { privateExposureEUR } from "@/components/private-value";
import type { AssetExposureMeta } from "@/lib/exposure.functions";
import type { PositionInput } from "@/lib/exposure-types";
import { exposurePct } from "@/lib/exposure-display";
import { OVERLAP_HIGH, OVERLAP_MEDIUM, portfolioOverlap, type OverlapLevel } from "@/lib/overlap";

const LEVEL: Record<OverlapLevel, { tone: "loss" | "warn" | "neutral"; label: string }> = {
  high: { tone: "loss", label: "Redundante" },
  medium: { tone: "warn", label: "Alta" },
  low: { tone: "neutral", label: "Baixa" },
};

/** Pares mostrados antes de "Ver todos". */
const VISIBLE = 6;

/**
 * Sobreposição entre os ETFs da carteira: que pares investem nas mesmas
 * empresas com o mesmo peso, e em quais empresas.
 */
export function EtfOverlapCard({
  positions,
  meta,
  hidden,
}: {
  positions: PositionInput[];
  meta: AssetExposureMeta[];
  hidden: boolean;
}) {
  const [all, setAll] = useState(false);
  const result = useMemo(
    () =>
      portfolioOverlap(
        positions,
        new Set(meta.filter((m) => m.holdingsStatus === "full").map((m) => m.assetId)),
      ),
    [positions, meta],
  );
  if (result.compared + result.skipped.length < 2) return null;

  const redundant = result.pairs.filter((p) => p.level === "high").length;
  const relevant = result.pairs.filter((p) => p.level !== "low").length;
  const status =
    redundant > 0
      ? {
          tone: "loss" as const,
          label: `${redundant} ${redundant === 1 ? "par redundante" : "pares redundantes"}`,
        }
      : relevant > 0
        ? {
            tone: "warn" as const,
            label: `${relevant} ${relevant === 1 ? "par" : "pares"} com sobreposição alta`,
          }
        : { tone: "gain" as const, label: "Sem sobreposição relevante" };
  const shown = all ? result.pairs : result.pairs.slice(0, VISIBLE);

  return (
    <Card
      title="Sobreposição entre ETFs"
      icon={<Layers aria-hidden className="h-4 w-4 text-primary" />}
      action={<Badge tone={status.tone}>{status.label}</Badge>}
      description={`Parte de cada ETF que está nas mesmas empresas, com o mesmo peso, que o outro. Acima de ${exposurePct(OVERLAP_HIGH * 100)} os dois são quase o mesmo investimento; acima de ${exposurePct(OVERLAP_MEDIUM * 100)} já reduzem a diversificação.`}
    >
      {result.pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Faltam ETFs com composição completa para comparar.
        </p>
      ) : (
        <ul className="space-y-4">
          {shown.map((p) => {
            const level = LEVEL[p.level];
            return (
              <li key={`${p.a}|${p.b}`}>
                <div className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{p.aName}</span>
                    <span className="text-muted-foreground"> e </span>
                    <span className="font-medium">{p.bName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.commonCount.toLocaleString("pt-PT")} empresas em comum ·{" "}
                      {privateExposureEUR(p.aValue, hidden)} e{" "}
                      {privateExposureEUR(p.bValue, hidden)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {p.level !== "low" && <Badge tone={level.tone}>{level.label}</Badge>}
                    <span className="num font-medium">{exposurePct(p.overlap * 100)}</span>
                  </span>
                </div>
                <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-sm bg-secondary">
                  <div
                    className={
                      p.level === "high"
                        ? "h-full bg-destructive"
                        : p.level === "medium"
                          ? "h-full bg-warning"
                          : "h-full bg-primary"
                    }
                    style={{ width: `${Math.min(100, p.overlap * 100)}%` }}
                  />
                </div>
                {p.level !== "low" && p.top.length > 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Mais partilhadas:{" "}
                    {p.top
                      .slice(0, 3)
                      .map((t) => `${t.name} (${exposurePct(t.weight * 100)})`)
                      .join(", ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {result.pairs.length > VISIBLE && (
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setAll((v) => !v)}>
          {all ? "Ver menos" : `Ver todos os ${result.pairs.length} pares`}
        </Button>
      )}
      {result.skipped.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Fora da comparação por terem composição incompleta: {result.skipped.join(", ")}.
        </p>
      )}
    </Card>
  );
}
