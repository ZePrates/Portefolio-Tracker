import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card } from "@/components/ui-bits";
import { AXIS_LINE, AXIS_TICK, ChartFrame, ChartTooltip, GRID_PROPS } from "@/components/chart-kit";
import { dateXAxis, formatChartTooltipDate } from "@/lib/chart-dates";
import { formatDatePt, formatMoney, formatNumber } from "@/lib/format";
import type { CompanyAnalysis } from "@/lib/valuation/analyze";
import { isNum } from "@/lib/valuation/stats";
import type { CompanyData } from "@/lib/valuation/types";
import { Explainer, SimpleTable, Stat, StepList } from "@/components/valuation/bits";
import { big, money, mult, pct, positiveMult, signedPct } from "@/components/valuation/format";

export function ValuationSummary({
  data,
  analysis: a,
}: {
  data: CompanyData;
  analysis: CompanyAnalysis;
}) {
  const cur = data.market.currency;
  const used = a.composite.models.filter((m) => m.included);
  const shown = a.composite.models.filter((m) => m.baseWeight > 0 || m.value != null);
  const mrow = (k: string) => a.multiples.result.rows.find((r) => r.key === k);
  const q = a.health.quality;
  return (
    <div className="space-y-6">
      <Card
        title="Valor justo por modelo"
        description="Cada modelo olha para a empresa de um ângulo diferente. Só entram os indicados para este tipo de empresa; os pesos ajustam-se quando algum fica de fora."
      >
        <SimpleTable
          firstColWide
          head={["Modelo", "Valor por ação", "Potencial", "Peso", "Estado"]}
          rows={shown.map((m) => [
            m.label,
            money(m.value, cur),
            isNum(m.value) ? signedPct(m.value / data.market.price - 1) : "—",
            m.included ? pct(m.weight, 0) : "—",
            m.included ? (
              <Badge tone="gain">Conta</Badge>
            ) : (
              <span className="inline-block max-w-72 whitespace-normal text-left text-[12px] text-muted-foreground">
                {m.reason}
              </span>
            ),
          ])}
        />
        <StepList
          className="mt-4"
          rows={[
            {
              label: "Valor justo ponderado",
              formula:
                used.map((m) => `${pct(m.weight, 0)} × ${money(m.value, cur)}`).join(" + ") ||
                "Sem modelos aplicáveis",
              value: money(a.composite.fairValue, cur),
              strong: true,
            },
            {
              label: "Intervalo dos modelos",
              formula: "Do modelo mais baixo ao mais alto que contam",
              value: `${money(a.composite.low, cur)} – ${money(a.composite.high, cur)}`,
            },
            {
              label: "Potencial face ao preço",
              formula: `${money(a.composite.fairValue, cur)} ÷ ${money(data.market.price, cur)} − 1 (±15 % = perto do valor justo)`,
              value: signedPct(a.composite.upside),
              strong: true,
            },
          ]}
        />
      </Card>

      <PriceChart data={data} analysis={a} />

      <Card title="Indicadores principais">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="P/E (12 meses)"
            value={positiveMult(data.market.trailingPE)}
            hint="Preço ÷ lucro por ação dos últimos 12 meses. Com prejuízo não tem significado."
          />
          <Stat
            label="P/E futuro"
            value={positiveMult(data.market.forwardPE)}
            hint="Preço ÷ lucro por ação esperado para os próximos 12 meses. Com prejuízo esperado não tem significado."
          />
          <Stat
            label="EV/EBITDA"
            value={mult(mrow("evEbitda")?.own)}
            hint="Valor da empresa (capitalização + dívida − caixa) ÷ EBITDA."
          />
          <Stat
            label="P/VC"
            value={mult(data.market.priceToBook)}
            hint="Preço ÷ valor contabilístico do capital próprio por ação."
          />
          <Stat
            label="Dividendo"
            value={pct(data.market.dividendYield, 2)}
            hint="Dividendo anual ÷ preço."
          />
          <Stat label="Margem operacional" value={pct(q.operatingMargin)} />
          <Stat
            label="ROIC"
            value={pct([...a.eva.history].reverse().find((e) => isNum(e.roic))?.roic)}
            hint="Retorno do capital investido: NOPAT ÷ capital investido. Acima do WACC, a empresa cria valor."
          />
          <Stat
            label="WACC"
            value={pct(a.wacc.wacc)}
            hint="Custo médio do capital (separador Valor justo)."
          />
          <Stat label="Dívida líquida / EBITDA" value={mult(q.netDebtToEbitda)} />
          <Stat label="Receita (crescimento anual)" value={signedPct(q.revenueCagr)} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <AnalystsCard data={data} />
        <Card
          title="Resultados face ao esperado"
          description="Lucro por ação de cada trimestre contra a estimativa média dos analistas."
        >
          {data.earnings.length ? (
            <SimpleTable
              head={["Trimestre", "Estimativa", "Real", "Surpresa"]}
              rows={data.earnings.map((e) => [
                formatDatePt(e.period),
                money(e.estimate, cur),
                money(e.actual, cur),
                <span
                  key="s"
                  className={
                    isNum(e.surprisePct)
                      ? e.surprisePct >= 0
                        ? "text-success"
                        : "text-destructive"
                      : ""
                  }
                >
                  {signedPct(e.surprisePct)}
                </span>,
              ])}
            />
          ) : (
            <Explainer>Sem histórico de resultados trimestrais no Yahoo Finance.</Explainer>
          )}
        </Card>
      </div>

      <PeersCard data={data} analysis={a} />
      <ProfileCard data={data} />
    </div>
  );
}

function PriceChart({ data, analysis: a }: { data: CompanyData; analysis: CompanyAnalysis }) {
  const cur = data.market.currency;
  const points = data.priceHistory.map((p) => ({ date: p.date, Preço: p.close }));
  const fv = a.composite.fairValue;
  const target = data.analysts.targetMean;
  const values = [
    ...points.map((p) => p.Preço),
    ...(isNum(fv) ? [fv] : []),
    ...(isNum(target) ? [target] : []),
  ];
  const lo = Math.min(...values) * 0.95;
  const hi = Math.max(...values) * 1.05;
  return (
    <Card
      title="Preço nos últimos 12 meses"
      description="Com o valor justo dos modelos e o alvo médio dos analistas como referência."
    >
      <ChartFrame
        label="Preço da ação nos últimos 12 meses, com o valor justo e o alvo dos analistas"
        height={240}
        empty={points.length < 2}
      >
        <LineChart data={points}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis
            dataKey="date"
            tick={AXIS_TICK}
            axisLine={AXIS_LINE}
            tickLine={false}
            {...dateXAxis(points.map((p) => p.date))}
          />
          <YAxis
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={56}
            domain={[lo, hi]}
            tickFormatter={(v: number) => formatNumber(v, v >= 100 ? 0 : 2)}
          />
          <Tooltip
            content={
              <ChartTooltip
                labelFormatter={formatChartTooltipDate}
                valueFormatter={(v) => formatMoney(v, cur)}
              />
            }
          />
          {isNum(fv) && (
            <ReferenceLine
              y={fv}
              stroke="var(--color-primary)"
              strokeDasharray="6 4"
              label={{
                value: "Valor justo",
                position: "insideTopLeft",
                fontSize: 11,
                fill: "var(--color-primary)",
              }}
            />
          )}
          {isNum(target) && (
            <ReferenceLine
              y={target}
              stroke="var(--color-info)"
              strokeDasharray="2 4"
              label={{
                value: "Analistas",
                position: "insideBottomLeft",
                fontSize: 11,
                fill: "var(--color-info)",
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="Preço"
            stroke="var(--color-chart-2)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartFrame>
    </Card>
  );
}

const REC_LABELS: Record<string, string> = {
  strong_buy: "Compra forte",
  buy: "Compra",
  hold: "Manter",
  underperform: "Abaixo do mercado",
  sell: "Venda",
};

function AnalystsCard({ data }: { data: CompanyData }) {
  const an = data.analysts;
  const cur = data.market.currency;
  const r = an.ratings;
  const total = r ? r.strongBuy + r.buy + r.hold + r.sell + r.strongSell : 0;
  const seg = r
    ? [
        { label: "Compra forte", n: r.strongBuy, cls: "bg-success" },
        { label: "Compra", n: r.buy, cls: "bg-success/60" },
        { label: "Manter", n: r.hold, cls: "bg-warning/70" },
        { label: "Venda", n: r.sell, cls: "bg-destructive/60" },
        { label: "Venda forte", n: r.strongSell, cls: "bg-destructive" },
      ]
    : [];
  return (
    <Card title="Consenso dos analistas">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Alvo médio" value={money(an.targetMean, cur)} />
        <Stat label="Mínimo" value={money(an.targetLow, cur)} />
        <Stat label="Máximo" value={money(an.targetHigh, cur)} />
      </div>
      <p className="mt-3 text-[13px]">
        {an.count ?? 0} analistas · recomendação média{" "}
        <strong>
          {an.recommendationKey ? (REC_LABELS[an.recommendationKey] ?? an.recommendationKey) : "—"}
        </strong>
        {isNum(an.recommendationMean) &&
          ` (${formatNumber(an.recommendationMean, 1)} numa escala de 1 a 5)`}
      </p>
      {total > 0 && (
        <>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full" aria-hidden>
            {seg.map((s) =>
              s.n > 0 ? (
                <div key={s.label} className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
              ) : null,
            )}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {seg
              .filter((s) => s.n > 0)
              .map((s) => `${s.label}: ${s.n}`)
              .join(" · ")}
          </p>
        </>
      )}
      <p className="mt-3 text-[12px] text-muted-foreground">
        Crescimento esperado da receita: {signedPct(an.revenueGrowthCurrentYear)} este ano,{" "}
        {signedPct(an.revenueGrowthNextYear)} no próximo. Lucro por ação:{" "}
        {signedPct(an.epsGrowthNextYear)} no próximo ano.
      </p>
    </Card>
  );
}

function PeersCard({ data, analysis: a }: { data: CompanyData; analysis: CompanyAnalysis }) {
  const peers = data.peers;
  return (
    <Card
      title="Empresas comparáveis"
      description={
        peers.length
          ? `Pares ${data.peerSource === "finnhub" ? "da mesma sub-indústria (Finnhub)" : "sugeridos pelo Yahoo Finance, filtrados pelo setor"}. Com menos de 3 valores válidos num múltiplo, usa-se a indústria «${a.context.industry.industry.name}» do Damodaran.`
          : `Sem pares disponíveis: os múltiplos usam a indústria «${a.context.industry.industry.name}» do Damodaran.`
      }
    >
      {peers.length > 0 && (
        <SimpleTable
          head={["Empresa", "P/E", "P/E futuro", "EV/EBITDA", "EV/EBIT", "EV/Vendas", "P/VC"]}
          rows={peers.map((p) => [
            <span key="n">
              {p.name} <span className="text-muted-foreground">({p.symbol})</span>
            </span>,
            mult(p.pe),
            mult(p.forwardPe),
            mult(p.evEbitda),
            mult(p.evEbit),
            mult(p.evSales),
            mult(p.pb),
          ])}
        />
      )}
    </Card>
  );
}

function ProfileCard({ data }: { data: CompanyData }) {
  const [open, setOpen] = useState(false);
  const p = data.profile;
  if (!p.summary && !p.employees && !p.website) return null;
  const text = p.summary ?? "";
  const short = text.length > 420 && !open ? `${text.slice(0, 420)}…` : text;
  return (
    <Card title="A empresa">
      {text && (
        <p className="text-[13px] leading-relaxed text-muted-foreground" lang="en">
          {short}{" "}
          {text.length > 420 && (
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => setOpen(!open)}
            >
              {open ? "Ler menos" : "Ler mais"}
            </button>
          )}
        </p>
      )}
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        {isNum(p.employees) && `${formatNumber(p.employees, 0)} trabalhadores · `}
        Capitalização {big(data.market.marketCap, data.market.currency)}
        {p.website && (
          <>
            {" · "}
            <a
              className="text-primary hover:underline"
              href={p.website}
              target="_blank"
              rel="noreferrer"
            >
              {p.website.replace(/^https?:\/\//, "")}
            </a>
          </>
        )}
      </p>
    </Card>
  );
}
