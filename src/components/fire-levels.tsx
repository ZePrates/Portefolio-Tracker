import type { FireDetails } from "@/lib/fire";
import { formatEUR, formatMonthPt, formatNumber, formatPct } from "@/lib/format";
import { MetricCard } from "@/components/ui-bits";

function when(years: number | null, month: string | null, hidden: boolean): string {
  if (years === 0) return "Atingido";
  if (years == null || !month) return "Fora de alcance";
  if (hidden) return formatEUR(0, true);
  return `${formatMonthPt(month)} · ${formatNumber(years, 1)} anos`;
}

/** Escada de patamares FIRE, Coast FIRE e FIRE com impostos. */
export function FireLevels({ details, hidden }: { details: FireDetails; hidden: boolean }) {
  const next = details.levels.find((l) => !l.reached);
  const reached = details.levels.filter((l) => l.reached).length;
  const tax = details.tax;

  return (
    <div className="space-y-5 border-t border-border pt-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Patamares</h3>
          <p className="text-xs text-muted-foreground">
            {reached} de {details.levels.length} atingidos
            {next ? ` · próximo: ${next.name}` : ""}
          </p>
        </div>
        <ol className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {details.levels.map((l) => (
            <li
              key={l.key}
              title={l.info}
              className={`rounded-lg border p-3 ${
                l === next ? "border-primary/60" : "border-border"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium">{l.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {formatNumber(l.multiple, 1)}×
                </span>
              </div>
              <p className="num mt-1 text-[15px] font-medium">{formatEUR(l.target, hidden)}</p>
              <div
                role="progressbar"
                aria-label={`Progresso ${l.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={hidden ? undefined : Math.round(l.progressPct)}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: hidden ? "0%" : `${l.progressPct}%` }}
                />
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {l.reached
                  ? "✓ Atingido"
                  : `${formatPct(l.progressPct, 0, hidden)} · ${when(l.years, l.month, hidden)}`}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Cada patamar é um múltiplo do número FIRE: Half/Barista (metade das despesas pagas pela
          carteira), Lean (vida frugal), FIRE e Fat (mais folga).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:gap-4 sm:grid-cols-2">
        <MetricCard
          label="Coast FIRE · se parares de investir hoje"
          value={when(details.coast.years, details.coast.month, hidden)}
          sub="só com o crescimento real da carteira atual, sem mais aportes"
        />
        {tax && (
          <MetricCard
            label={`FIRE com impostos (${formatPct(tax.rate * 100, 0)} sobre mais-valias)`}
            value={formatEUR(tax.fireNumber, hidden)}
            sub={`${when(tax.yearsToFire, tax.fireMonth, hidden)} · hoje ${formatPct(
              tax.gainSharePct,
              0,
              hidden,
            )} da carteira é mais-valia → imposto efetivo de ${formatPct(
              tax.effectiveRatePct,
              1,
              hidden,
            )} por levantamento`}
          />
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Estimativa em euros de hoje. O imposto assume a taxa liberatória e o custo médio das
        posições abertas; o custo perde valor real com a inflação e cresce com os aportes. Não é
        aconselhamento financeiro.
      </p>
    </div>
  );
}
