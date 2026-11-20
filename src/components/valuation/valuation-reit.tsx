import { Badge, Card } from "@/components/ui-bits";
import { formatNumber } from "@/lib/format";
import type { CompanyAnalysis } from "@/lib/valuation/analyze";
import { isNum } from "@/lib/valuation/stats";
import type { CompanyData } from "@/lib/valuation/types";
import { Explainer, ScorePill, SimpleTable, StepList } from "@/components/valuation/bits";
import { big, money, mult, num, pct, signedPct } from "@/components/valuation/format";

export function ValuationReit({
  data,
  analysis: a,
}: {
  data: CompanyData;
  analysis: CompanyAnalysis;
}) {
  const reit = a.reit;
  if (!reit) return <Explainer>Esta empresa não é um REIT.</Explainer>;
  const r = reit.analysis;
  const cur = data.market.currency;
  const as = a.assumptions;
  const payoutTone = !isNum(r.affoPayout)
    ? "neutral"
    : r.affoPayout <= 0.8
      ? "gain"
      : r.affoPayout <= 1
        ? "warn"
        : "loss";
  return (
    <div className="space-y-6">
      <Card
        title="Nota REIT"
        action={<ScorePill score={reit.score.score} max={10} label="Nota REIT" />}
        description={`Segmento: ${reit.reference.label}. A nota resume o preço, a segurança do dividendo, a dívida e o crescimento do FFO. É um resumo para estudo, não uma recomendação.`}
      >
        <SimpleTable
          head={["Componente", "Pontos", "Máximo"]}
          rows={reit.score.parts.map((p) => [
            p.label,
            formatNumber(p.points, 2),
            formatNumber(p.max, 1),
          ])}
        />
        <p className="mt-2 text-[12px] text-muted-foreground">
          A ocupação dos imóveis não vem nas contas públicas: confirma-a no relatório trimestral do
          REIT.
        </p>
      </Card>

      <Card
        title="P/FFO e P/AFFO"
        description="Nos REITs o lucro contabilístico é deprimido pelas amortizações dos imóveis (que, na prática, até valorizam). O FFO repõe-nas; o AFFO desconta o investimento de manutenção."
      >
        <StepList
          rows={[
            {
              label: "FFO",
              formula:
                "Resultado líquido + amortizações + imparidades − mais-valias na venda de imóveis (NAREIT)",
              value: big(r.ffo, cur),
            },
            {
              label: "AFFO pelo FFO",
              formula: `FFO − ${pct(as.maintenanceCapexPct, 0)} das amortizações (capex de manutenção)`,
              value: big(r.affoFromFfo, cur),
            },
            {
              label: "AFFO pela caixa",
              formula:
                "Fluxo de caixa operacional − capex de manutenção (sem imparidades de investimentos nem rendas lineares)",
              value: big(r.affoFromCash, cur),
            },
            {
              label: "AFFO usado",
              formula:
                r.affoSource === "caixa"
                  ? "O mais baixo dos dois: a caixa confirma menos do que o FFO sugere"
                  : r.affoFromCash == null || r.affoFromCash <= 0
                    ? "Sem fluxo de caixa operacional positivo: fica o AFFO pelo FFO"
                    : "O mais baixo dos dois: o FFO",
              value: big(r.affo, cur),
              strong: true,
            },
            { label: "FFO por ação", value: money(r.ffoPerShare, cur) },
            { label: "AFFO por ação", value: money(r.affoPerShare, cur) },
            { label: "P/FFO", value: mult(r.pFfo), strong: true },
            {
              label: "P/AFFO",
              formula: `Referência do segmento: ${mult(as.pAffoTarget)}`,
              value: mult(r.pAffo),
              strong: true,
            },
            {
              label: "Ajuste ao ano em curso",
              formula:
                "Crescimento da receita esperado pelos analistas este ano, aplicado ao AFFO e ao NOI do valor justo (entre −30 % e +15 %)",
              value: signedPct(r.forwardFactor - 1),
            },
            {
              label: "Valor pelo P/AFFO de referência",
              formula: `${money(r.affoPerShare, cur)} × ${num(r.forwardFactor, 3)} × ${mult(as.pAffoTarget)}`,
              value: money(r.affoValue, cur),
              strong: true,
            },
          ]}
        />
        <SimpleTable
          className="mt-4"
          head={["Ano", "FFO por ação"]}
          rows={r.ffoHistory.map((h) => [h.period.slice(0, 4), money(h.ffoPerShare, cur)])}
        />
        <p className="mt-2 text-[12px] text-muted-foreground">
          Crescimento anual do FFO por ação: {signedPct(r.ffoGrowth)}.
        </p>
      </Card>

      <Card
        title="Valor dos imóveis (NAV) e cap rate"
        description="Quanto valeriam os imóveis a preços de mercado: as rendas líquidas (NOI) divididas pela cap rate de transações do segmento, menos a dívida."
      >
        <StepList
          rows={[
            {
              label: "NOI",
              formula: "Aproximado pelo EBITDA normalizado (sem imparidades)",
              value: big(r.noi, cur),
            },
            {
              label: "Valor da empresa (EV)",
              formula: "Capitalização + dívida líquida",
              value: big(r.enterpriseValue, cur),
            },
            {
              label: "Cap rate implícita no preço",
              formula: "NOI ÷ EV: o rendimento que o mercado está a pagar pelos imóveis",
              value: pct(r.impliedCapRate, 2),
            },
            { label: "Cap rate de mercado (referência)", value: pct(as.capRate, 2) },
            {
              label: "NAV",
              formula: `NOI × ${num(r.forwardFactor, 3)} (ano em curso) ÷ cap rate de mercado − dívida líquida`,
              value: big(r.nav, cur),
            },
            { label: "NAV por ação", value: money(r.navPerShare, cur), strong: true },
            {
              label: "Prémio (+) ou desconto (−) face ao NAV",
              value: signedPct(r.premiumToNav),
              strong: true,
            },
          ]}
        />
        <p className="mt-2 text-[12px] text-muted-foreground">
          Cap rate implícita acima da de mercado = os imóveis estão baratos na bolsa (desconto face
          ao NAV).
        </p>
      </Card>

      <Card
        title="Dividendo e dívida"
        action={<Badge tone={payoutTone}>Payout do AFFO {pct(r.affoPayout, 0)}</Badge>}
      >
        <StepList
          rows={[
            { label: "Dividendo anual por ação", value: money(data.market.dividendRate, cur) },
            { label: "Rendimento do dividendo", value: pct(data.market.dividendYield, 2) },
            {
              label: "Payout do AFFO",
              formula:
                "Dividendos ÷ AFFO (até 80 % é confortável; acima de 100 % paga mais do que gera)",
              value: pct(r.affoPayout, 0),
              strong: true,
            },
            {
              label: "Dívida líquida ÷ EBITDA",
              formula: "Até 5–6× é habitual nos REITs",
              value: mult(r.netDebtToEbitda),
            },
            {
              label: "Dívida ÷ ativo (LTV)",
              formula: "Abaixo de 40–45 % é prudente",
              value: pct(r.debtToAssets),
            },
            {
              label: "Cobertura de juros",
              formula: "EBITDA ÷ juros",
              value: mult(r.interestCoverage),
            },
          ]}
        />
      </Card>
    </div>
  );
}
