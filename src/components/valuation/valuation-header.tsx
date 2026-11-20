import type { ReactNode } from "react";
import { ExternalLink, FileDown, RefreshCw, TriangleAlert, Info } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui-bits";
import { InfoTip } from "@/components/info-tip";
import { cn } from "@/lib/utils";
import type { CompanyAnalysis } from "@/lib/valuation/analyze";
import { PROFILE_DESCRIPTIONS, PROFILE_LABELS } from "@/lib/valuation/classify";
import { isNum } from "@/lib/valuation/stats";
import type { CompanyData } from "@/lib/valuation/types";
import { ScorePill, VerdictBadge } from "@/components/valuation/bits";
import { money, num, signedPct, EMPTY } from "@/components/valuation/format";
import { formatDatePt } from "@/lib/format";

/** Barra horizontal: intervalo dos modelos, valor justo, preço e alvo dos analistas. */
function RangeBar({ data, a }: { data: CompanyData; a: CompanyAnalysis }) {
  const { low, high, fairValue } = a.composite;
  const price = data.market.price;
  const target = data.analysts.targetMean;
  if (!isNum(low) || !isNum(high) || !isNum(fairValue)) return null;
  const pts = [low, high, price, ...(isNum(target) ? [target] : [])];
  const min = Math.min(...pts) * 0.92;
  const max = Math.max(...pts) * 1.08;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const cur = data.market.currency;
  const legend = [
    { label: "Valor justo", value: fairValue, cls: "bg-primary" },
    { label: "Preço", value: price, cls: "bg-foreground" },
    ...(isNum(target) ? [{ label: "Analistas", value: target, cls: "bg-info" }] : []),
  ];
  return (
    <div className="mt-4">
      <div className="relative h-5" aria-hidden>
        <div className="absolute inset-x-0 top-2 h-1.5 rounded-full bg-secondary" />
        <div
          className="absolute top-2 h-1.5 rounded-full bg-primary/35"
          style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }}
        />
        {legend.map((l) => (
          <span
            key={l.label}
            className={cn("absolute top-0 block h-5 w-[3px] -translate-x-1/2 rounded", l.cls)}
            style={{ left: pos(l.value) }}
          />
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        <span>{money(low, cur)}</span>
        <span>{money(high, cur)}</span>
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        {legend.map((l) => (
          <li key={l.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("inline-block h-3 w-[3px] rounded", l.cls)} />
            {l.label} <span className="num text-foreground">{money(l.value, cur)}</span>
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-1.5 w-4 rounded-full bg-primary/35" />
          Intervalo dos modelos
        </li>
      </ul>
    </div>
  );
}

export function ValuationHeader({
  data,
  analysis: a,
  onRefresh,
  refreshing,
  actions,
}: {
  data: CompanyData;
  analysis: CompanyAnalysis;
  onRefresh: () => void;
  refreshing: boolean;
  /** Botões extra à esquerda de «Atualizar» (ex.: watchlist). */
  actions?: ReactNode;
}) {
  const p = data.profile;
  const m = data.market;
  const cur = m.currency;
  const type = a.classification.type;
  const warnings = a.flags.filter((f) => f.severity === "aviso");
  const infos = a.flags.filter((f) => f.severity === "info");
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{p.name}</h2>
              <Badge tone="neutral">{p.symbol}</Badge>
              <Badge tone="primary">{PROFILE_LABELS[type]}</Badge>
              <InfoTip label="Porque é este o tipo de empresa?">
                <p>{PROFILE_DESCRIPTIONS[type]}</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {a.classification.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </InfoTip>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {[p.sector, p.industry, p.country, p.exchange].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2" data-print-hide>
            {actions}
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <FileDown aria-hidden className="h-3.5 w-3.5" />
              Exportar PDF
            </Button>
            <a
              className="inline-flex items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
              href={`https://finance.yahoo.com/quote/${encodeURIComponent(p.symbol)}`}
              target="_blank"
              rel="noreferrer"
            >
              Yahoo <ExternalLink aria-hidden className="h-3 w-3" />
            </a>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div>
            <p className="text-[12.5px] text-muted-foreground">Preço</p>
            <p className="num mt-1 text-2xl font-bold">{money(m.price, cur)}</p>
            <p className="num mt-1 text-xs text-muted-foreground">
              12 meses: {signedPct(a.priceStats.change12m)} · do máximo:{" "}
              {signedPct(a.priceStats.fromHigh)}
            </p>
          </div>
          <div>
            <p className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
              Valor justo ponderado
              <InfoTip label="Como se calcula o valor justo?">
                Média ponderada dos modelos que se aplicam a este tipo de empresa (separador
                Resumo). Os pesos ajustam-se quando um modelo fica de fora.
              </InfoTip>
            </p>
            <p className="num mt-1 text-2xl font-bold text-primary">
              {money(a.composite.fairValue, cur)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={cn(
                  "num font-semibold",
                  (a.composite.upside ?? 0) >= 0.15 && "text-success",
                  (a.composite.upside ?? 0) <= -0.15 && "text-destructive",
                )}
              >
                Potencial {signedPct(a.composite.upside)}
              </span>
              <VerdictBadge verdict={a.composite.verdict} />
              {!a.composite.reliable && <Badge tone="warn">Potencial pouco fiável</Badge>}
            </div>
          </div>
          <div>
            <p className="text-[12.5px] text-muted-foreground">Nota global</p>
            <div className="mt-1.5 flex items-center gap-2">
              <ScorePill score={a.score.total} label="Nota global" />
              <span className="text-[11.5px] leading-tight text-muted-foreground">
                {a.score.parts
                  .map((x) => `${x.label} ${isNum(x.value) ? num(x.value, 0) : EMPTY}`)
                  .join(" · ")}
              </span>
            </div>
            <p className="num mt-2 text-xs text-muted-foreground">
              Alvo de {data.analysts.count ?? 0} analistas: {money(data.analysts.targetMean, cur)}
              {isNum(a.composite.analystGap) && ` (modelos ${signedPct(a.composite.analystGap)})`}
            </p>
          </div>
        </div>
        <RangeBar data={data} a={a} />
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          Dados públicos do Yahoo Finance e do Damodaran (jan/2026), recolhidos a{" "}
          {formatDatePt(data.fetchedAt)}. Ferramenta de estudo: os valores são estimativas e não são
          recomendação de investimento.
        </p>
      </Card>

      {warnings.length > 0 && (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-4"
        >
          {warnings.map((f) => (
            <p key={f.kind} className="flex gap-2 text-[13px]">
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              {f.text}
            </p>
          ))}
        </div>
      )}
      {(infos.length > 0 || data.warnings.length > 0) && (
        <div className="space-y-1.5 rounded-xl border border-border bg-card/60 p-4">
          {infos.map((f) => (
            <p key={f.kind} className="flex gap-2 text-[12.5px] text-muted-foreground">
              <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {f.text}
            </p>
          ))}
          {data.warnings
            .filter((w) => !w.startsWith("Contas convertidas"))
            .map((w) => (
              <p key={w} className="flex gap-2 text-[12.5px] text-muted-foreground">
                <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {w}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
