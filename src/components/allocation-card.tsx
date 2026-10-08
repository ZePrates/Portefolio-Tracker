import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { CLASS_LABELS } from "@/lib/portfolio-types";
import type { AllocationSlice } from "@/lib/dashboard";
import { formatEUR, formatPct, formatPp } from "@/lib/format";
import { Card } from "@/components/ui-bits";
import { CLASS_COLOR } from "@/components/chart-kit";
import { CLASS_ROUTES } from "@/components/nav-config";

/** Abaixo deste desvio (em pontos percentuais) a classe considera-se "no alvo". */
const ON_TARGET_PP = 0.3;
/** A partir deste desvio o valor fica a amarelo. */
const WARN_PP = 1;
/** Desvio que enche a mini-barra (cada lado). */
const MINI_BAR_FULL_PP = 5;

function DriftCell({ drift, hidden }: { drift: number; hidden: boolean }) {
  const onTarget = Math.abs(drift) < ON_TARGET_PP;
  const half = Math.min(1, Math.abs(drift) / MINI_BAR_FULL_PP) * 50;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span
        aria-hidden
        className="relative hidden h-1 w-11 shrink-0 rounded-full bg-foreground/10 sm:block"
      >
        {!hidden && !onTarget && (
          <span
            className="absolute inset-y-0 rounded-full bg-foreground/50"
            style={
              drift > 0 ? { left: "50%", width: `${half}%` } : { right: "50%", width: `${half}%` }
            }
          />
        )}
        <span className="absolute inset-y-[-2px] left-1/2 w-px bg-foreground/30" />
      </span>
      <span
        className={cn(
          "num whitespace-nowrap text-[13px]",
          !hidden && Math.abs(drift) >= WARN_PP ? "text-warning" : "text-foreground/80",
        )}
      >
        {hidden ? formatPp(0, 1, true) : onTarget ? "no alvo" : formatPp(drift, 1)}
      </span>
    </span>
  );
}

export function AllocationCard({
  allocation,
  drifts,
  hidden,
}: {
  allocation: AllocationSlice[];
  /** Desvio face ao alvo por classe (pp); `null` quando não há alvos definidos. */
  drifts: Map<string, number> | null;
  hidden: boolean;
}) {
  const hasTargets = drifts !== null;
  return (
    <Card
      headingLevel={2}
      title="Alocação"
      action={
        <Link
          to="/objetivos"
          className="inline-flex min-h-11 sm:min-h-6 items-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {hasTargets ? "Objetivos →" : "Definir alvos →"}
        </Link>
      }
    >
      {allocation.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Dados não disponíveis</p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`Alocação por classe: ${allocation
              .map((c) => `${CLASS_LABELS[c.class]} ${hidden ? "" : formatPct(c.pct, 1)}`)
              .join(", ")}`}
            className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-foreground/5"
          >
            {allocation.map((c) => (
              <span
                key={c.class}
                className="h-full rounded-full"
                style={{ width: hidden ? 0 : `${c.pct}%`, background: CLASS_COLOR[c.class] }}
              />
            ))}
          </div>

          <table className="mt-3 w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-[12px] font-normal text-muted-foreground">
                <th scope="col" className="py-1.5 pr-2 font-normal">
                  Classe
                </th>
                <th scope="col" className="hidden py-1.5 pr-3 text-right font-normal sm:table-cell">
                  Valor
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-normal">
                  Peso
                </th>
                {hasTargets && (
                  <th scope="col" className="py-1.5 text-right font-normal">
                    Desvio do alvo
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {allocation.map((c) => (
                <tr key={c.class} className="border-b border-foreground/5 last:border-b-0">
                  <td className="h-11 py-[9px] pr-2 sm:h-auto">
                    <Link
                      to={CLASS_ROUTES[c.class]}
                      className="inline-flex min-h-11 sm:min-h-6 min-w-0 items-center gap-2 hover:underline"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-[2px]"
                        style={{ background: CLASS_COLOR[c.class] }}
                      />
                      <span className="truncate">{CLASS_LABELS[c.class]}</span>
                    </Link>
                  </td>
                  <td className="num hidden py-[9px] pr-3 text-right sm:table-cell">
                    {formatEUR(c.value, hidden)}
                  </td>
                  <td className="num py-[9px] pr-3 text-right text-muted-foreground">
                    {formatPct(c.pct, 1, hidden)}
                  </td>
                  {hasTargets && (
                    <td className="py-[9px] text-right">
                      <DriftCell drift={drifts.get(c.class) ?? 0} hidden={hidden} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}
