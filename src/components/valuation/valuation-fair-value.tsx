import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card } from "@/components/ui-bits";
import { AXIS_LINE, AXIS_TICK, ChartFrame, ChartTooltip, GRID_PROPS } from "@/components/chart-kit";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  SCENARIO_LABELS,
  SCENARIO_WEIGHTS,
  type CompanyAnalysis,
  type ScenarioKey,
} from "@/lib/valuation/analyze";
import type { Assumptions } from "@/lib/valuation/assumptions";
import { isNum } from "@/lib/valuation/stats";
import type { CompanyData } from "@/lib/valuation/types";
import { AssumptionsPanel } from "@/components/valuation/assumptions-panel";
import { Explainer, SimpleTable, StepList } from "@/components/valuation/bits";
import { big, money, mult, num, pct, signedPct, EMPTY } from "@/components/valuation/format";

const BETA_CHOICE: Record<string, string> = {
  "bottom-up": "beta da indústria ajustado à dívida (bottom-up)",
  regressao: "beta de regressão (Yahoo, 5 anos)",
  industria: "beta médio da indústria",
  omissao: "valor por omissão",
};

export function ValuationFairValue({
  data,
  analysis: a,
  overrides,
  onOverrides,
}: {
  data: CompanyData;
  analysis: CompanyAnalysis;
  overrides: Partial<Assumptions>;
  onOverrides: (next: Partial<Assumptions>) => void;
}) {
  return (
    <div className="space-y-6">
      <AssumptionsPanel analysis={a} overrides={overrides} onChange={onOverrides} />
      <WaccCard data={data} a={a} />
      {a.dcf.applicable ? <DcfCard data={data} a={a} /> : null}
      <MultiplesCard data={data} a={a} />
      <DdmCard data={data} a={a} />
      {a.classification.type !== "financeira" && <EvaCard data={data} a={a} />}
      {a.bank && <BankCard data={data} a={a} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function WaccCard({ data, a }: { data: CompanyData; a: CompanyAnalysis }) {
  const as = a.assumptions;
  const w = a.wacc;
  const ctx = a.context;
  const financial = a.classification.type === "financeira";
  const rows = [
    { label: "Taxa sem risco (rf)", formula: data.macro.riskFreeLabel, value: pct(as.riskFree, 2) },
    {
      label: "Beta (β)",
      formula: `${BETA_CHOICE[ctx.betaChoice]} · regressão ${num(ctx.betaRegression)} · bottom-up ${num(ctx.betaBottomUp)}`,
      value: num(as.beta),
    },
    {
      label: "Prémio de risco do mercado (ERP)",
      formula: "S&P 500, implícito (Damodaran, jan/2026)",
      value: pct(as.matureErp, 2),
    },
    {
      label: "Prémio de risco do país (CRP)",
      formula: ctx.country.found
        ? `${ctx.country.country}, rating ${ctx.country.rating ?? "—"}`
        : "Mercado maduro",
      value: pct(as.crp, 2),
    },
    {
      label: "Custo do capital próprio (rE)",
      formula: `rf + β × ERP + CRP = ${pct(as.riskFree, 2)} + ${num(as.beta)} × ${pct(as.matureErp, 2)} + ${pct(as.crp, 2)}`,
      value: pct(w.costOfEquity, 2),
      strong: true,
    },
  ];
  if (!financial) {
    rows.push(
      {
        label: "Custo da dívida antes de impostos (rD)",
        formula: `rf + spread do rating sintético ${ctx.rating.rating}${isNum(ctx.rating.coverage) ? ` (cobertura de juros ${formatNumber(ctx.rating.coverage, 1)}×)` : ""}`,
        value: pct(as.preTaxCostOfDebt, 2),
        strong: false,
      },
      {
        label: "Custo da dívida depois de impostos",
        formula: `rD × (1 − ${pct(as.marginalTax, 1)})`,
        value: pct(w.costOfDebtAfterTax, 2),
        strong: false,
      },
      {
        label: "Pesos a valores de mercado",
        formula: `Capital ${big(data.market.marketCap, data.market.currency)} · dívida ${big(data.statements.totalDebt.at(-1) ?? 0, data.market.currency)}`,
        value: `${pct(w.weightEquity, 0)} / ${pct(w.weightDebt, 0)}`,
        strong: false,
      },
      {
        label: "WACC",
        formula: "E/(D+E) × rE + D/(D+E) × rD × (1 − t)",
        value: pct(w.wacc, 2),
        strong: true,
      },
    );
  }
  return (
    <Card
      title={financial ? "Custo do capital próprio" : "Taxa de desconto (WACC)"}
      description={
        financial
          ? "Nos bancos desconta-se ao custo do capital próprio: a dívida é matéria-prima do negócio, não financiamento."
          : "Quanto rendem, em média, os acionistas e os credores para financiar a empresa. É a taxa que desconta os fluxos de caixa no DCF e no EVA."
      }
    >
      <StepList rows={rows} />
      {!financial && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Beta de Hamada: βL = βU × (1 + (1 − t) × D/E). Com D/E de {pct(ctx.debtToEquity)} e a
          indústria «{ctx.industry.industry.name}» (βU {num(ctx.industry.industry.unleveredBeta)}),
          o beta ajustado é {num(ctx.betaBottomUp)}.
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function DcfCard({ data, a }: { data: CompanyData; a: CompanyAnalysis }) {
  const cur = data.market.currency;
  const base = a.dcf.scenarios.base;
  const r = base.result;
  const keys: ScenarioKey[] = ["pessimista", "base", "otimista"];
  const ig = a.dcf.impliedGrowth;
  return (
    <Card
      title="DCF: fluxos de caixa descontados"
      description="Estima o valor da empresa pelos fluxos de caixa livres que vai gerar, descontados ao WACC. Anos 1–5 a crescer, anos 6–10 a abrandar até ao crescimento perpétuo, e um valor terminal."
    >
      <SimpleTable
        firstColWide
        head={[
          "Cenário",
          "Receita (anos 1–5)",
          "Margem no ano 10",
          "Crescimento perpétuo",
          "Valor por ação",
          "Peso",
        ]}
        rows={keys.map((k) => {
          const s = a.dcf.scenarios[k];
          return [
            SCENARIO_LABELS[k],
            signedPct(s.inputs.growth),
            pct(s.inputs.targetMargin),
            pct(s.inputs.terminalGrowth),
            money(s.result?.perShare, cur),
            pct(SCENARIO_WEIGHTS[k], 0),
          ];
        })}
      />
      <StepList
        className="mt-3"
        rows={[
          {
            label: "Valor do DCF (média ponderada dos cenários)",
            formula: "25 % pessimista + 50 % base + 25 % otimista",
            value: money(a.dcf.value, cur),
            strong: true,
          },
        ]}
      />

      {r && (
        <>
          <h3 className="mt-6 text-[14px] font-semibold">Projeção do cenário base</h3>
          <SimpleTable
            className="mt-2"
            head={[
              "Ano",
              "Receita",
              "Cresc.",
              "Margem",
              "EBIT",
              "Imposto",
              "NOPAT",
              "Reinvest.",
              "FCFF",
              "Valor atual",
            ]}
            rows={r.years.map((y) => [
              `Ano ${y.year}`,
              big(y.revenue, cur),
              signedPct(y.growth),
              pct(y.margin),
              big(y.ebit, cur),
              pct(y.taxRate, 0),
              big(y.nopat, cur),
              big(y.reinvestment, cur),
              big(y.fcff, cur),
              big(y.presentValue, cur),
            ])}
          />
          <StepList
            className="mt-4"
            rows={[
              { label: "Soma do valor atual dos FCFF (anos 1–10)", value: big(r.pvExplicit, cur) },
              {
                label: "Valor terminal no ano 10",
                formula: `FCFF₁₁ ÷ (WACC − g) = ${big(r.terminalFcff, cur)} ÷ (${pct(base.inputs.wacc, 2)} − ${pct(base.inputs.terminalGrowth, 2)}); ROIC terminal ${pct(base.inputs.terminalRoic)}`,
                value: big(r.terminalValue, cur),
              },
              {
                label: "Valor atual do valor terminal",
                formula: `${pct(r.terminalShare, 0)} do valor da empresa`,
                value: big(r.pvTerminal, cur),
              },
              { label: "Valor da empresa (EV)", value: big(r.enterpriseValue, cur), strong: true },
              { label: "+ Caixa", value: big(base.inputs.cash, cur) },
              { label: "− Dívida", value: big(base.inputs.debt, cur) },
              { label: "− Interesses minoritários", value: big(base.inputs.minorityInterest, cur) },
              { label: "= Capital próprio", value: big(r.equityValue, cur) },
              {
                label: "Valor por ação",
                formula: `÷ ${formatNumber(base.inputs.shares / 1e6, 1)} milhões de ações`,
                value: money(r.perShare, cur),
                strong: true,
              },
            ]}
          />
        </>
      )}

      <div className="mt-6 rounded-lg border border-border bg-secondary/40 p-4">
        <h3 className="text-[14px] font-semibold">O que o preço atual assume (DCF invertido)</h3>
        <p className="mt-1 text-[13px]">
          {isNum(ig) ? (
            <>
              Ao preço de {money(data.market.price, cur)}, o mercado assume que a receita cresce{" "}
              <strong className="num">{signedPct(ig)}</strong> ao ano nos próximos 5 anos,{" "}
              {Math.abs(ig - base.inputs.growth) < 0.01
                ? "em linha com o que o modelo assume"
                : ig > base.inputs.growth
                  ? `acima do que o modelo assume (${signedPct(base.inputs.growth)})`
                  : `abaixo do que o modelo assume (${signedPct(base.inputs.growth)})`}
              .
            </>
          ) : (
            "Não há um crescimento entre −30 % e 80 % que justifique o preço atual com estes pressupostos."
          )}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Mesmo WACC, margem e reinvestimento do cenário base; só muda o crescimento.
        </p>
      </div>

      {a.dcf.sensitivity && <SensitivityTable data={data} a={a} />}
      {a.dcf.monteCarlo && <MonteCarloBlock data={data} a={a} />}
    </Card>
  );
}

function SensitivityTable({ data, a }: { data: CompanyData; a: CompanyAnalysis }) {
  const g = a.dcf.sensitivity!;
  const price = data.market.price;
  const cur = data.market.currency;
  return (
    <div className="mt-6">
      <h3 className="text-[14px] font-semibold">Sensibilidade: WACC × crescimento perpétuo</h3>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Valor por ação do cenário base. A verde, acima do preço atual; a vermelho, abaixo.
      </p>
      <div className="-mx-4 mt-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        <table className="w-full min-w-max border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th
                scope="col"
                className="px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground"
              >
                WACC \ g
              </th>
              {g.growths.map((x) => (
                <th
                  key={x}
                  scope="col"
                  className="num px-2 py-1.5 text-right text-[11px] font-medium text-muted-foreground"
                >
                  {pct(x)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.waccs.map((w, i) => (
              <tr key={w} className="border-t border-border/60">
                <th scope="row" className="num px-2 py-1.5 text-left font-medium">
                  {pct(w)}
                </th>
                {g.values[i]!.map((v, j) => (
                  <td
                    key={j}
                    className={cn(
                      "num px-2 py-1.5 text-right",
                      isNum(v) && v >= price && "text-success",
                      isNum(v) && v < price && "text-destructive",
                      i === 2 && j === 2 && "rounded bg-secondary font-semibold",
                    )}
                  >
                    {isNum(v) ? formatMoney(v, cur) : EMPTY}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonteCarloBlock({ data, a }: { data: CompanyData; a: CompanyAnalysis }) {
  const mc = a.dcf.monteCarlo!;
  const cur = data.market.currency;
  const price = data.market.price;
  const bars = mc.bins.map((b) => ({ x: (b.from + b.to) / 2, Simulações: b.count }));
  return (
    <div className="mt-6">
      <h3 className="text-[14px] font-semibold">
        Monte Carlo: {formatNumber(mc.runs, 0)} simulações
      </h3>
      <p className="mt-1 text-[12px] text-muted-foreground">
        O crescimento, a margem, o WACC e o crescimento perpétuo variam à volta do cenário base.
        Mostra a incerteza do valor, não uma previsão.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="Pessimista (P10)" value={money(mc.p10, cur)} />
        <MiniStat label="Mediana (P50)" value={money(mc.p50, cur)} />
        <MiniStat label="Otimista (P90)" value={money(mc.p90, cur)} />
        <MiniStat label="Valor acima do preço" value={pct(mc.probAbovePrice, 0)} />
      </div>
      <ChartFrame
        label="Distribuição do valor por ação nas simulações de Monte Carlo"
        height={200}
        className="mt-3"
      >
        <BarChart data={bars}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis
            dataKey="x"
            tick={AXIS_TICK}
            axisLine={AXIS_LINE}
            tickLine={false}
            tickFormatter={(v: number) => formatNumber(v, 0)}
          />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
          <Tooltip
            content={
              <ChartTooltip
                labelFormatter={(l) => `Cerca de ${formatMoney(Number(l), cur)}`}
                valueFormatter={(v) => formatNumber(v, 0)}
              />
            }
          />
          <ReferenceLine
            x={bars.reduce(
              (best, b) => (Math.abs(b.x - price) < Math.abs(best - price) ? b.x : best),
              bars[0]?.x ?? price,
            )}
            stroke="var(--color-foreground)"
            strokeDasharray="4 3"
            label={{
              value: "Preço",
              position: "top",
              fontSize: 11,
              fill: "var(--color-foreground)",
            }}
          />
          <Bar dataKey="Simulações" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartFrame>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="num mt-0.5 text-[14px] font-semibold">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MultiplesCard({ data, a }: { data: CompanyData; a: CompanyAnalysis }) {
  const cur = data.market.currency;
  const res = a.multiples.result;
  return (
    <Card
      title="Múltiplos dos pares"
      description="Quanto o mercado paga por empresas comparáveis, aplicado aos números desta. Usa-se a mediana dos pares, sem negativos nem extremos (P/E acima de 80, EV/EBIT acima de 60). Só os indicados para o tipo de empresa entram no valor, com o mesmo peso."
    >
      <SimpleTable
        firstColWide
        head={["Múltiplo", "A empresa", "Referência", "1.º quartil", "Preço implícito", ""]}
        rows={res.rows.map((r) => [
          r.label,
          mult(r.own),
          r.reference != null ? (
            <span key="ref">
              {mult(r.reference)}{" "}
              <span className="text-[11px] text-muted-foreground">
                {r.source === "pares" ? `${r.peerCount} pares` : "indústria"}
              </span>
            </span>
          ) : (
            EMPTY
          ),
          mult(r.peerQ1),
          r.impliedPrice != null ? (
            money(r.impliedPrice, cur)
          ) : (
            <span className="inline-block max-w-56 whitespace-normal text-left text-[11px] text-muted-foreground">
              {r.note}
            </span>
          ),
          r.counts ? (
            <Badge tone="gain">Conta</Badge>
          ) : (
            <span className="text-[11px] text-muted-foreground">Referência</span>
          ),
        ])}
      />
      <StepList
        className="mt-3"
        rows={[
          {
            label: "Valor pelos múltiplos",
            formula: "Média simples dos preços implícitos que contam",
            value: money(res.value, cur),
            strong: true,
          },
        ]}
      />
      <Explainer>
        Os múltiplos do valor da empresa (EV) convertem-se em preço por ação: EV implícito − dívida
        + caixa − minoritários, a dividir pelas ações.
      </Explainer>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function DdmCard({ data, a }: { data: CompanyData; a: CompanyAnalysis }) {
  const cur = data.market.currency;
  const d = a.ddm;
  const pv = d.pvgo;
  return (
    <Card
      title="Dividendos (DDM) e oportunidades de crescimento (PVGO)"
      description="O valor de uma ação é a soma dos dividendos futuros descontados ao custo do capital próprio. O PVGO mostra que parte do preço paga crescimento futuro."
    >
      {d.dividend && d.twoStage ? (
        <>
          <StepList
            rows={[
              { label: "Dividendo anual por ação (D₀)", value: money(d.dividend, cur) },
              { label: "Custo do capital próprio (kₑ)", value: pct(a.wacc.costOfEquity, 2) },
              {
                label: "Crescimento nos anos 1–5 (g₁)",
                formula: a.notes.dividendGrowth,
                value: pct(a.assumptions.dividendGrowth),
              },
              { label: "Crescimento perpétuo (g₂)", value: pct(a.assumptions.terminalGrowth) },
              {
                label: "Valor terminal no ano 5",
                formula: "D₅ × (1 + g₂) ÷ (kₑ − g₂)",
                value: money(d.twoStage.terminalValue, cur),
              },
              {
                label: "Valor pelo DDM de duas fases",
                value: money(d.twoStage.value, cur),
                strong: true,
              },
              {
                label: "Gordon (crescimento constante desde já)",
                formula: "D₁ ÷ (kₑ − g₂)",
                value: money(d.gordonValue, cur),
              },
            ]}
          />
          <SimpleTable
            className="mt-4"
            head={["Cenário", "Crescimento g₁", "kₑ", "Valor por ação"]}
            rows={d.scenarios.map((s) => [
              s.key === "pessimista" ? "Pior" : s.key === "otimista" ? "Melhor" : "Normal",
              pct(s.growth),
              pct(s.costOfEquity, 2),
              money(s.value, cur),
            ])}
          />
          <p className="mt-2 text-[12.5px]">
            Valor do DDM (25 % / 50 % / 25 %):{" "}
            <strong className="num">{money(d.value, cur)}</strong>
            {!d.applicable && d.reason && (
              <span className="text-muted-foreground"> · fica fora do valor justo: {d.reason}</span>
            )}
          </p>
        </>
      ) : (
        <Explainer>{d.reason ?? "Sem dividendos."} O DDM não se aplica.</Explainer>
      )}
      {pv && (
        <StepList
          className="mt-4"
          rows={[
            {
              label: "Valor sem crescimento",
              formula: `Lucro por ação ÷ kₑ = ${money(a.multiples.inputs.eps, cur)} ÷ ${pct(a.wacc.costOfEquity, 2)}`,
              value: money(pv.noGrowthValue, cur),
            },
            {
              label: "PVGO = preço − valor sem crescimento",
              formula: `${pct(pv.share, 0)} do preço paga crescimento futuro`,
              value: money(pv.pvgo, cur),
              strong: true,
            },
          ]}
        />
      )}
      {pv && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {pv.share > 0.6
            ? "Mais de 60 % do preço depende de crescimento: se o crescimento desiludir, a queda pode ser grande."
            : pv.share < 0
              ? "O preço está abaixo do valor dos lucros atuais sem crescimento: o mercado espera que os lucros caiam."
              : "Boa parte do preço está suportada pelos lucros atuais."}
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function EvaCard({ data, a }: { data: CompanyData; a: CompanyAnalysis }) {
  const cur = data.market.currency;
  const wacc = a.wacc.wacc;
  const v = a.eva.valuation;
  const c = a.eva.creation;
  const model = a.composite.models.find((m) => m.key === "eva");
  return (
    <Card
      title="Lucro económico (EVA, EP e MVA)"
      description="Uma empresa só cria valor quando o retorno do capital investido (ROIC) supera o custo desse capital (WACC). EVA = NOPAT − WACC × capital investido."
    >
      <SimpleTable
        head={["Ano", "Capital investido", "NOPAT", "ROIC", "WACC", "EVA"]}
        rows={a.eva.history.map((e) => [
          e.period.slice(0, 4),
          big(e.investedCapital, cur),
          big(e.nopat, cur),
          <span
            key="r"
            className={isNum(e.roic) ? (e.roic >= wacc ? "text-success" : "text-destructive") : ""}
          >
            {pct(e.roic)}
          </span>,
          pct(wacc),
          big(e.eva, cur),
        ])}
      />
      <StepList
        className="mt-4"
        rows={[
          {
            label: "MVA (valor de mercado acrescentado)",
            formula:
              "Valor de mercado da empresa − capital investido: a riqueza criada para quem investiu",
            value: big(c.mva, cur),
          },
          {
            label: "Valor das operações atuais",
            formula: "Capital investido + EVA ÷ WACC (se o EVA de hoje se mantiver)",
            value: big(c.currentOperationsValue, cur),
          },
          {
            label: "Valor de crescimento futuro",
            formula: `${pct(c.futureGrowthShare, 0)} do valor de mercado só se justifica com crescimento`,
            value: big(c.futureGrowthValue, cur),
            strong: true,
          },
        ]}
      />
      {v && (
        <>
          <h3 className="mt-6 text-[14px] font-semibold">Avaliação pelo EVA</h3>
          <StepList
            className="mt-2"
            rows={[
              { label: "Capital investido hoje", value: big(a.context.investedCapital, cur) },
              {
                label: "Valor atual dos EVA dos anos 1–10",
                formula: `ROIC a convergir para ${pct(v.terminalRoic)} (WACC + 30 % do diferencial atual)`,
                value: big(v.pvEva, cur),
              },
              { label: "Valor atual do EVA depois do ano 10", value: big(v.pvTerminal, cur) },
              { label: "Valor da empresa", value: big(v.firmValue, cur) },
              {
                label: "Valor por ação",
                formula: "+ caixa − dívida − minoritários, ÷ ações",
                value: money(v.perShare, cur),
                strong: true,
              },
            ]}
          />
        </>
      )}
      {model && !model.included && model.reason && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Fora do valor justo: {model.reason}
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function BankCard({ data, a }: { data: CompanyData; a: CompanyAnalysis }) {
  const cur = data.market.currency;
  const b = a.bank!;
  const equity = data.statements.equity.at(-1) ?? null;
  const bvps = isNum(equity) ? equity / data.market.shares : null;
  return (
    <Card
      title="Banco: valor pelo capital próprio"
      description="Num banco, o valor depende de quanto rende o capital próprio (ROE) face ao que os acionistas exigem (kₑ)."
    >
      <StepList
        rows={[
          { label: "Valor contabilístico por ação", value: money(bvps, cur) },
          { label: "ROE médio (3 anos)", value: pct(b.roe) },
          { label: "Custo do capital próprio (kₑ)", value: pct(a.wacc.costOfEquity, 2) },
          { label: "Crescimento perpétuo (g)", value: pct(a.assumptions.terminalGrowth) },
          {
            label: "P/VC justificado",
            formula: "(ROE − g) ÷ (kₑ − g)",
            value: mult(b.justifiedPb, 2),
          },
          {
            label: "Valor pelo P/VC justificado",
            value: money(b.justifiedPbValue, cur),
            strong: true,
          },
          {
            label: "Valor pelo retorno em excesso",
            formula: "Capital próprio + Σ (ROE − kₑ) × capital, descontado (5 anos + perpetuidade)",
            value: money(b.excessReturnValue, cur),
            strong: true,
          },
        ]}
      />
      {b.years.length > 0 && (
        <SimpleTable
          className="mt-4"
          head={["Ano", "Capital próprio", "Retorno em excesso", "Valor atual"]}
          rows={b.years.map((y) => [
            `Ano ${y.year}`,
            big(y.bookValue, cur),
            big(y.excessReturn, cur),
            big(y.presentValue, cur),
          ])}
        />
      )}
    </Card>
  );
}
