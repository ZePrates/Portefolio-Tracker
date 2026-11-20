import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card } from "@/components/ui-bits";
import { AXIS_LINE, AXIS_TICK, ChartFrame, ChartTooltip, GRID_PROPS } from "@/components/chart-kit";
import { formatDatePt, formatNumber, formatPct } from "@/lib/format";
import type { CompanyAnalysis } from "@/lib/valuation/analyze";
import { isNum } from "@/lib/valuation/stats";
import type { CompanyData } from "@/lib/valuation/types";
import { Explainer, ScorePill, SimpleTable, Stat } from "@/components/valuation/bits";
import { big, money, pct, signedPct } from "@/components/valuation/format";

const SIGNAL = {
  compra: { label: "Insiders a comprar", tone: "gain" },
  venda: { label: "Insiders a vender", tone: "loss" },
  neutro: { label: "Sem sinal claro", tone: "neutral" },
  sem_dados: { label: "Sem dados", tone: "neutral" },
} as const;

export function ValuationManagement({
  data,
  analysis: a,
}: {
  data: CompanyData;
  analysis: CompanyAnalysis;
}) {
  const m = a.management;
  const cur = data.market.currency;
  const wacc = a.classification.type === "financeira" ? a.wacc.costOfEquity : a.wacc.wacc;
  const chart = a.eva.history
    .filter((e) => isNum(e.roic))
    .map((e) => ({ ano: e.period.slice(0, 4), ROIC: e.roic! * 100, WACC: wacc * 100 }));
  const sig = SIGNAL[m.insiders];
  return (
    <div className="space-y-6">
      <Card
        title="Nota da gestão"
        action={<ScorePill score={m.score.score} label="Gestão" />}
        description="O que a gestão faz com o dinheiro dos acionistas: cria valor, recompra ou dilui, cumpre o que promete e o que fazem os próprios gestores com as suas ações."
      >
        <SimpleTable
          head={["Critério", "Leitura", "Pontos"]}
          rows={m.score.parts.map((p) => [
            p.label,
            p.detail,
            `${formatNumber(p.points, 1)} / ${p.max}`,
          ])}
        />
      </Card>

      {a.classification.type !== "financeira" && (
        <Card
          title="Cria valor? ROIC face ao WACC"
          description="Se o retorno do capital fica abaixo do custo do capital, a empresa destrói valor mesmo com lucro contabilístico."
        >
          <ChartFrame label="ROIC e WACC por ano" height={220} empty={chart.length === 0}>
            <BarChart data={chart}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="ano" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
              <YAxis
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v: number) => `${formatNumber(v, 0)}%`}
              />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => formatPct(v)} />} />
              <Legend />
              <Bar dataKey="ROIC" fill="var(--color-chart-2)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="WACC" fill="var(--color-chart-5)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartFrame>
        </Card>
      )}

      <Card
        title="Alocação de capital"
        description="Último ano fiscal, em percentagem da capitalização de hoje."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Recompras" value={pct(m.allocation.buybackYield, 2)} />
          <Stat label="Dividendos" value={pct(m.allocation.dividendYield, 2)} />
          <Stat
            label="Rendimento total"
            value={pct(m.allocation.shareholderYield, 2)}
            hint="Dividendos + recompras ÷ capitalização."
          />
          <Stat
            label="Distribuído do FCF"
            value={pct(m.allocation.payoutOfFcf, 0)}
            hint="(Dividendos + recompras) ÷ fluxo de caixa livre. Acima de 100 % paga com dívida ou caixa."
          />
          <Stat
            label="Remuneração em ações"
            value={pct(m.allocation.sbcToRevenue)}
            hint="Em % da receita: é um custo real para os acionistas (diluição)."
          />
          <Stat
            label="Nº de ações (por ano)"
            value={signedPct(m.allocation.shareChange)}
            tone={
              isNum(m.allocation.shareChange) && m.allocation.shareChange > 0.01
                ? "negative"
                : "default"
            }
          />
        </div>
      </Card>

      <Card
        title="Promete e cumpre?"
        description="Resultados trimestrais face à estimativa média dos analistas."
        action={
          m.execution.quarters > 0 ? (
            <Badge tone={m.execution.beats >= m.execution.quarters / 2 ? "gain" : "warn"}>
              {m.execution.beats} de {m.execution.quarters} acima
            </Badge>
          ) : undefined
        }
      >
        {m.execution.quarters ? (
          <p className="text-[13px]">
            Surpresa média de{" "}
            <strong className="num">{signedPct(m.execution.averageSurprise)}</strong> nos últimos{" "}
            {m.execution.quarters} trimestres (detalhe no Resumo).
          </p>
        ) : (
          <Explainer>Sem histórico de surpresas de resultados.</Explainer>
        )}
      </Card>

      <Card
        title="Insiders (gestores e administradores)"
        description="Os gestores vendem por muitos motivos, mas só compram por um: acham que a ação vai subir."
        action={<Badge tone={sig.tone}>{sig.label}</Badge>}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Compras (6 meses)"
            value={isNum(data.insiders.buyShares) ? formatNumber(data.insiders.buyShares, 0) : "—"}
          />
          <Stat
            label="Vendas (6 meses)"
            value={
              isNum(data.insiders.sellShares) ? formatNumber(data.insiders.sellShares, 0) : "—"
            }
          />
          <Stat
            label="Saldo"
            value={isNum(data.insiders.netShares) ? formatNumber(data.insiders.netShares, 0) : "—"}
          />
          <Stat label="Detido por insiders" value={pct(data.insiders.heldPct, 2)} />
        </div>
        {data.insiders.transactions.length > 0 && (
          <SimpleTable
            className="mt-4"
            head={["Data", "Quem", "Operação", "Ações", "Valor"]}
            rows={data.insiders.transactions.map((t) => [
              formatDatePt(t.date),
              <span key="w">
                {t.name}
                {t.relation && (
                  <span className="block text-[11px] text-muted-foreground">{t.relation}</span>
                )}
              </span>,
              <span key="o" className="text-[12px]">
                {t.text ?? "—"}
              </span>,
              isNum(t.shares) ? formatNumber(t.shares, 0) : "—",
              isNum(t.value) && t.value > 0 ? big(t.value, cur) : "—",
            ])}
          />
        )}
      </Card>

      <p className="text-[12px] text-muted-foreground">
        Preço atual {money(data.market.price, cur)}; valores de capitalização na moeda da cotação.
      </p>
    </div>
  );
}
