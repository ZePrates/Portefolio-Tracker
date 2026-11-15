import { FIRE_INFO, type FireDetails } from "@/lib/fire";
import { InfoTip } from "@/components/info-tip";
import { formatMonthPt, formatNumber, formatPct } from "@/lib/format";
import { Badge, MetricCard } from "@/components/ui-bits";
import { privateEUR } from "@/components/private-value";

function when(years: number | null, month: string | null): string {
  if (years === 0) return "Atingido";
  if (years == null || !month) return "Fora de alcance";
  return `${formatMonthPt(month)} · ${formatNumber(years, 1)} anos`;
}

/** Escada de patamares FIRE, Coast FIRE e FIRE com impostos. */
export function FireLevels({ details, hidden }: { details: FireDetails; hidden: boolean }) {
  const next = details.levels.find((l) => !l.reached);
  const reached = details.levels.filter((l) => l.reached).length;
  const tax = details.tax;
  const flamingo = details.flamingo;

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
              className={`rounded-lg border p-3 ${
                l === next ? "border-primary/60" : "border-border"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-[13px] font-medium">
                  {l.name}
                  <InfoTip label={`O que é ${l.name}?`}>
                    <p className="font-medium">
                      {l.name} · {formatNumber(l.multiple, 1)}× o número FIRE
                    </p>
                    <p className="mt-1 text-muted-foreground">{l.info}</p>
                  </InfoTip>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatNumber(l.multiple, 1)}×
                </span>
              </div>
              <p className="num mt-1 text-[15px] font-medium">{privateEUR(l.target, hidden)}</p>
              <div
                role="progressbar"
                aria-label={`Progresso ${l.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(l.progressPct)}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${l.progressPct}%` }}
                />
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {l.reached
                  ? "✓ Atingido"
                  : `${formatPct(l.progressPct, 0)} · ${when(l.years, l.month)}`}
              </p>
            </li>
          ))}
          <li className="col-span-2 rounded-lg border border-dashed border-border p-3 lg:col-span-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[13px] font-medium">
                Flamingo FIRE
                <InfoTip label="O que é Flamingo FIRE?">
                  <p className="font-medium">Flamingo FIRE · 0,5× e depois sem aportes</p>
                  <p className="mt-1 text-muted-foreground">{FIRE_INFO.flamingo}</p>
                </InfoTip>
              </span>
              <span className="text-[11px] text-muted-foreground">0,5× → 1,0×</span>
            </div>
            <p className="mt-1 text-[15px] font-medium">
              <span className="num">{privateEUR(flamingo.target, hidden)}</span>
              <span className="text-[12px] font-normal text-muted-foreground">
                {" "}
                e depois paras de investir
              </span>
            </p>
            <div
              role="progressbar"
              aria-label="Progresso Flamingo FIRE"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(flamingo.progressPct)}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${flamingo.progressPct}%` }}
              />
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {flamingo.halfReached
                ? "✓ Metade atingida: podias parar os aportes hoje"
                : `${formatPct(flamingo.progressPct, 0)} · metade em ${when(flamingo.halfYears, flamingo.halfMonth)}`}
              {flamingo.coastYears != null &&
                ` · depois ${formatNumber(flamingo.coastYears, 1)} anos sem aportes`}
              {" → FIRE em "}
              {when(flamingo.fireYears, flamingo.fireMonth)}
            </p>
          </li>
        </ol>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Cada patamar é um múltiplo do número FIRE; o Flamingo usa a mesma metade do Half / Barista
          mas para os aportes aí. Passa o rato (ou toca) no ícone ⓘ para ver o que significa.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Cenários de retorno</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Quando chegas ao número FIRE com as mesmas despesas e aportes, mas outro retorno.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">Data do FIRE para vários retornos anuais</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Cenário
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Real
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Nominal
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">
                  FIRE
                </th>
              </tr>
            </thead>
            <tbody>
              {details.scenarios.map((s) => (
                <tr
                  key={s.key}
                  className={`border-b border-border/60 ${s.key === "yours" ? "font-medium" : ""}`}
                >
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {s.name}
                    {s.key === "yours" && details.optimistic && (
                      <Badge tone="warn" className="ml-2">
                        otimista
                      </Badge>
                    )}
                  </th>
                  <td className="num px-3 py-2 text-right">{formatPct(s.realReturnPct, 1)}</td>
                  <td className="num px-3 py-2 text-right">{formatPct(s.nominalReturnPct, 1)}</td>
                  <td className="num py-2 pl-3 text-right">{when(s.years, s.month)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:gap-4 sm:grid-cols-2">
        <MetricCard
          label={
            <span className="inline-flex items-center gap-1">
              Coast FIRE · se parares de investir hoje
              <InfoTip label="O que é Coast FIRE?">{FIRE_INFO.coast}</InfoTip>
            </span>
          }
          value={when(details.coast.years, details.coast.month)}
          sub="só com o crescimento real da carteira atual, sem mais aportes"
        />
        {tax && (
          <MetricCard
            label={
              <span className="inline-flex items-center gap-1">
                FIRE com impostos ({formatPct(tax.rate * 100, 0)} sobre mais-valias)
                <InfoTip label="O que é FIRE com impostos?">{FIRE_INFO.tax}</InfoTip>
              </span>
            }
            value={privateEUR(tax.fireNumber, hidden)}
            sub={`${when(tax.yearsToFire, tax.fireMonth)} · hoje ${formatPct(tax.gainSharePct, 0)} da carteira é mais-valia → imposto efetivo de ${formatPct(tax.effectiveRatePct, 1)} por levantamento`}
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
