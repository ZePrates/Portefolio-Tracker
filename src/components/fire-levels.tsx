import type { ReactNode } from "react";
import { Flame, Hourglass } from "lucide-react";
import { FIRE_INFO, type FireDetails, type FireLevel } from "@/lib/fire";
import { InfoTip } from "@/components/info-tip";
import {
  formatDurationPt,
  formatMonthLongPt,
  formatMonthPt,
  formatNumber,
  formatPct,
} from "@/lib/format";
import { Badge } from "@/components/ui-bits";
import { privateEUR } from "@/components/private-value";
import { cn } from "@/lib/utils";

function when(years: number | null, month: string | null): string {
  if (years === 0) return "Atingido";
  if (years == null || !month) return "Fora de alcance";
  return `${formatMonthPt(month)} · ${formatNumber(years, 1)} anos`;
}

/** "10a 5m · 2037" (ou "Atingido" / "Fora de alcance"). */
function shortWhen(months: number | null, month: string | null): string {
  if (months === 0) return "Atingido";
  if (months == null || !month) return "Fora de alcance";
  return `${formatDurationPt(months, true)} · ${month.slice(0, 4)}`;
}

const clampPct = (v: number) => Math.min(100, Math.max(0, v));

/**
 * Contagem decrescente para o FIRE: quanto tempo falta, em que mês e com que
 * capital. Fica no topo da secção, no lugar do antigo cartão "Previsão".
 */
export function FireCountdown({
  details,
  realReturnPct,
  hidden,
}: {
  details: FireDetails;
  realReturnPct: number;
  hidden: boolean;
}) {
  const fire = details.levels.find((l) => l.key === "fire");
  if (!fire) return null;

  let headline: string;
  let sub: ReactNode;
  if (fire.reached) {
    headline = "FIRE atingido";
    sub = <>a carteira já paga as despesas · {privateEUR(fire.target, hidden)}</>;
  } else if (fire.monthsAway == null || !fire.month) {
    headline = "Fora de alcance";
    sub = "não chega ao número FIRE em 100 anos com os aportes e o retorno atuais";
  } else {
    headline = formatDurationPt(fire.monthsAway);
    sub = (
      <>
        em {formatMonthLongPt(fire.month)} · {privateEUR(fire.target, hidden)}
      </>
    );
  }

  return (
    <section
      aria-label="Tempo até ao FIRE"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-warning/40 bg-gradient-to-r from-warning/15 via-warning/5 to-transparent px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-warning">
          <Flame aria-hidden className="h-4 w-4" />
          {fire.reached ? "Independência financeira" : "Faltam para o FIRE"}
        </span>
        <span className="num text-2xl font-bold">{headline}</span>
        <span className="text-sm text-muted-foreground">{sub}</span>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        retorno real {formatPct(realReturnPct, 1)}
        {details.optimistic && <Badge tone="warn">otimista</Badge>}
      </p>
    </section>
  );
}

/** Um degrau da escada: barra do progresso dentro do degrau, alvo e tempo. */
function LevelStep({
  level,
  prevTarget,
  value,
  isNext,
  hidden,
}: {
  level: FireLevel;
  prevTarget: number;
  value: number;
  isNext: boolean;
  hidden: boolean;
}) {
  const span = level.target - prevTarget;
  const stepPct = level.reached
    ? 100
    : span > 0
      ? clampPct(((value - prevTarget) / span) * 100)
      : 0;
  const isGoal = level.key === "fire";

  return (
    <li className="min-w-0">
      {/* Marcador "Hoje" por cima do degrau em que estás. */}
      <div className={cn("relative", isNext ? "h-8" : "hidden sm:block sm:h-8")}>
        {isNext && (
          <span
            className="absolute bottom-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-sm"
            style={{ left: `${Math.min(85, Math.max(15, stepPct))}%` }}
          >
            Hoje · {privateEUR(value, hidden)}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={`Progresso no degrau ${level.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(stepPct)}
        className={cn(
          "h-2 overflow-hidden rounded-full bg-secondary",
          isNext && "ring-1 ring-primary/40",
        )}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${stepPct}%` }} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1 text-[13px] font-semibold",
            isNext && "text-primary",
            isGoal && !isNext && "text-warning",
          )}
        >
          {isGoal && <Flame aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning" />}
          <span className="truncate">{level.name}</span>
          <InfoTip label={`O que é ${level.name}?`}>
            <p className="font-medium">
              {level.name} · {formatNumber(level.multiple, 1)}× o número FIRE
            </p>
            <p className="mt-1 text-muted-foreground">{level.info}</p>
          </InfoTip>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatNumber(level.multiple, 1)}×
        </span>
      </div>
      <p className="num text-[15px] font-medium">{privateEUR(level.target, hidden)}</p>
      <p
        className={cn(
          "mt-0.5 inline-flex items-center gap-1 text-[12px]",
          isGoal && !level.reached ? "font-medium text-warning" : "text-muted-foreground",
        )}
      >
        {level.reached ? (
          "✓ Atingido"
        ) : (
          <>
            <Hourglass aria-hidden className="h-3 w-3 shrink-0" />
            {shortWhen(level.monthsAway, level.month)}
          </>
        )}
      </p>
      {!level.reached && (
        <p className="text-[12px] text-muted-foreground">
          {formatPct(level.progressPct, 0)} · faltam {privateEUR(level.remaining, hidden)}
        </p>
      )}
    </li>
  );
}

/** Caixa de um conceito FIRE que não é um degrau da escada (Coast, Flamingo, impostos). */
function SideBox({
  title,
  info,
  infoLabel,
  value,
  children,
}: {
  title: string;
  info: ReactNode;
  infoLabel: string;
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3">
      <p className="inline-flex items-center gap-1 text-[13px] font-medium">
        {title}
        <InfoTip label={infoLabel}>{info}</InfoTip>
      </p>
      <p className="num mt-1 text-[15px] font-semibold">{value}</p>
      <div className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">{children}</div>
    </div>
  );
}

/** Escada de patamares FIRE, Coast/Flamingo FIRE, FIRE com impostos e cenários. */
export function FireLevels({ details, hidden }: { details: FireDetails; hidden: boolean }) {
  const next = details.levels.find((l) => !l.reached);
  const reached = details.levels.filter((l) => l.reached).length;
  const { tax, flamingo, coast } = details;

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
        <ol className="mt-1 grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-4 sm:gap-y-0">
          {details.levels.map((l, i) => (
            <LevelStep
              key={l.key}
              level={l}
              prevTarget={i === 0 ? 0 : details.levels[i - 1]!.target}
              value={details.portfolioValue}
              isNext={l === next}
              hidden={hidden}
            />
          ))}
        </ol>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Cada degrau é um múltiplo do número FIRE e a barra mostra o progresso dentro desse degrau
          (do anterior até este). Toca no ícone ⓘ para ver o que significa.
        </p>
      </div>

      <div className={cn("grid grid-cols-1 gap-3", tax ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <SideBox
          title="Coast FIRE"
          infoLabel="O que é Coast FIRE?"
          info={FIRE_INFO.coast}
          value={
            coast.monthsAway === 0
              ? "Atingido"
              : coast.monthsAway == null
                ? "Fora de alcance"
                : formatDurationPt(coast.monthsAway)
          }
        >
          <p>se parares de investir hoje</p>
          {coast.month && coast.monthsAway !== 0 && (
            <p>FIRE em {formatMonthLongPt(coast.month)}, só com o crescimento da carteira</p>
          )}
        </SideBox>

        <SideBox
          title="Flamingo FIRE"
          infoLabel="O que é Flamingo FIRE?"
          info={
            <>
              <p className="font-medium">Flamingo FIRE · 0,5× e depois sem aportes</p>
              <p className="mt-1 text-muted-foreground">{FIRE_INFO.flamingo}</p>
            </>
          }
          value={privateEUR(flamingo.target, hidden)}
        >
          <div
            role="progressbar"
            aria-label="Progresso Flamingo FIRE"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(flamingo.progressPct)}
            className="my-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${flamingo.progressPct}%` }}
            />
          </div>
          <p>
            {flamingo.halfReached
              ? "✓ Metade atingida: podes parar os aportes"
              : `${formatPct(flamingo.progressPct, 0)} · metade em ${shortWhen(flamingo.monthsToHalf, flamingo.halfMonth)}`}
          </p>
          <p>
            {"depois sem aportes: FIRE em "}
            {flamingo.fireMonth ? formatMonthLongPt(flamingo.fireMonth) : "fora de alcance"}
          </p>
        </SideBox>

        {tax && (
          <SideBox
            title={`FIRE com impostos (${formatPct(tax.rate * 100, 0)})`}
            infoLabel="O que é FIRE com impostos?"
            info={FIRE_INFO.tax}
            value={privateEUR(tax.fireNumber, hidden)}
          >
            <p>
              {tax.yearsToFire === 0
                ? "✓ Atingido"
                : tax.fireMonth
                  ? `FIRE em ${formatMonthLongPt(tax.fireMonth)}`
                  : "Fora de alcance"}
            </p>
            <p>
              hoje {formatPct(tax.gainSharePct, 0)} da carteira é mais-valia → imposto efetivo de{" "}
              {formatPct(tax.effectiveRatePct, 1)} por levantamento
            </p>
          </SideBox>
        )}
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

      <p className="text-[12px] text-muted-foreground">
        Estimativa em euros de hoje. O imposto assume a taxa liberatória e o custo médio das
        posições abertas; o custo perde valor real com a inflação e cresce com os aportes. Não é
        aconselhamento financeiro.
      </p>
    </div>
  );
}
