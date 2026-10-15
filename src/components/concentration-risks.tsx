import { CircleCheck, TriangleAlert } from "lucide-react";
import { Badge, Card } from "@/components/ui-bits";
import { portfolioIntelligence } from "@/lib/intelligence";
import type { ExposureReport } from "@/lib/exposure";
import type { PositionInput } from "@/lib/exposure-types";
import type { Asset } from "@/lib/portfolio-types";

/**
 * Riscos de concentração (antiga página Inteligência): mesmos limites e o
 * mesmo motor (look-through), sem a pontuação. Cada risco aparece com o
 * respetivo número; sem riscos, um sinal verde.
 */
export function ConcentrationRisks({
  assets,
  report,
  positions,
  hidden,
}: {
  assets: Asset[];
  report: ExposureReport | undefined;
  positions: PositionInput[] | undefined;
  hidden: boolean;
}) {
  const intel = portfolioIntelligence(assets, report, positions);
  const n = intel.risks.length;
  const status =
    n === 0
      ? { tone: "gain" as const, label: "Sem riscos materiais" }
      : {
          tone: n >= 3 ? ("loss" as const) : ("warn" as const),
          label: `${n} ${n === 1 ? "risco" : "riscos"}`,
        };
  const text = (s: string) => (hidden ? "Detalhe escondido no modo privado." : s);

  return (
    <Card
      title="Riscos de concentração"
      action={<Badge tone={status.tone}>{status.label}</Badge>}
      description="Limites: 10 % numa empresa, 30 % nas 5 maiores, 40 % num setor, 50 % num país e 70 % numa moeda. O peso de cada empresa dentro dos ETFs conta."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Riscos identificados</h3>
          {n === 0 ? (
            <p className="flex items-center gap-2 text-sm">
              <CircleCheck aria-hidden className="h-4 w-4 shrink-0 text-success" />
              Nenhum limite ultrapassado.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {intel.risks.map((r) => (
                <li key={r} className="flex items-start gap-2">
                  <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <span>{text(r)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">O que fazer</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {intel.recommendations.map((r) => (
              <li key={r}>{text(r)}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        A correspondência entre uma ação detida diretamente e a mesma empresa dentro de um ETF é
        feita pelo nome, por isso é aproximada. São indicadores quantitativos, não aconselhamento
        financeiro.
      </p>
    </Card>
  );
}
