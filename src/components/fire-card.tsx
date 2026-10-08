import { Link } from "@tanstack/react-router";
import type { FireProgress } from "@/lib/fire";
import { formatEUR, formatMonthPt, formatPct } from "@/lib/format";
import { Card } from "@/components/ui-bits";

const MARKS = [25, 50, 75] as const;

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className="num mt-0.5 break-words text-[15px] font-medium">{children}</dd>
    </div>
  );
}

export function FireCard({ progress, hidden }: { progress: FireProgress | null; hidden: boolean }) {
  const pct = progress ? Math.min(100, Math.max(0, progress.progressPct)) : 0;
  return (
    <Card
      headingLevel={2}
      title="Independência financeira"
      action={
        <Link
          to="/objetivos"
          className="inline-flex min-h-6 items-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {progress ? "Objetivos →" : "Definir objetivo →"}
        </Link>
      }
    >
      {!progress ? (
        <p className="py-6 text-sm text-muted-foreground">
          Define as tuas despesas anuais para veres quanto falta para o teu número FIRE.
        </p>
      ) : (
        <div>
          <p className="num text-4xl font-semibold leading-10 tracking-[-0.02em]">
            {formatPct(progress.progressPct, 1, hidden)}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            de <span className="num">{formatEUR(progress.fireNumber, hidden)}</span>
          </p>

          <div className="relative mt-4">
            <div
              role="progressbar"
              aria-label="Progresso FIRE"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={hidden ? undefined : Math.round(pct)}
              className="h-2 overflow-hidden rounded-full bg-foreground/10"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: hidden ? "0%" : `${pct}%` }}
              />
            </div>
            {MARKS.map((m) => (
              <span
                key={m}
                aria-hidden
                className="absolute top-0 h-2 w-px bg-background/70"
                style={{ left: `${m}%` }}
              />
            ))}
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4">
            <Metric label="Falta">{formatEUR(progress.remaining, hidden)}</Metric>
            {progress.fireMonth && (
              <Metric label="Data estimada">
                {hidden ? formatEUR(0, true) : formatMonthPt(progress.fireMonth)}
              </Metric>
            )}
            <Metric label="Despesas cobertas por dividendos">
              {formatPct(progress.passiveCoveragePct, 1, hidden)}
            </Metric>
          </dl>
        </div>
      )}
    </Card>
  );
}
