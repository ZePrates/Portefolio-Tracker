import { Badge, Card } from "@/components/ui-bits";
import { formatNumber } from "@/lib/format";
import type { CompanyAnalysis } from "@/lib/valuation/analyze";
import { DAMODARAN_UPDATED, DAMODARAN_URL } from "@/lib/valuation/damodaran-data";
import { VERDICT_LABELS, type MarketVerdict } from "@/lib/valuation/macro";
import type { CompanyData } from "@/lib/valuation/types";
import { Explainer, StepList, Stat } from "@/components/valuation/bits";
import { mult, pct, signedPct } from "@/components/valuation/format";

const TONE: Record<MarketVerdict, "gain" | "neutral" | "loss"> = {
  acoes_atrativas: "gain",
  neutro: "neutral",
  acoes_caras: "loss",
};

export function ValuationMacro({
  data,
  analysis: a,
}: {
  data: CompanyData;
  analysis: CompanyAnalysis;
}) {
  const { fed, yardeni } = a.macro;
  const c = a.context.country;
  const ind = a.context.industry.industry;
  return (
    <div className="space-y-6">
      <Card
        title="FED Model: ações face às obrigações"
        description="Compara o rendimento dos lucros do S&P 500 (o inverso do P/E) com o da obrigação do Tesouro dos EUA a 10 anos."
        action={
          fed ? <Badge tone={TONE[fed.verdict]}>{VERDICT_LABELS[fed.verdict]}</Badge> : undefined
        }
      >
        {fed ? (
          <StepList
            rows={[
              {
                label: "P/E do S&P 500 (12 meses)",
                formula: "Via SPY",
                value: mult(data.macro.sp500PE),
              },
              {
                label: "Rendimento dos lucros",
                formula: "1 ÷ P/E",
                value: pct(fed.earningsYield, 2),
              },
              { label: "Treasury a 10 anos", value: pct(fed.bondYield, 2) },
              {
                label: "Prémio das ações",
                formula: "Rendimento dos lucros − Treasury (positivo favorece as ações)",
                value: signedPct(fed.spread, 2),
                strong: true,
              },
            ]}
          />
        ) : (
          <Explainer>Sem o P/E do S&P 500 ou a taxa a 10 anos neste momento.</Explainer>
        )}
      </Card>

      <Card
        title="Modelo de Yardeni"
        description="P/E justo do mercado = 1 ÷ (rendimento das obrigações de empresas Aaa − 0,1 × crescimento dos lucros a longo prazo). Junta o risco de crédito e o crescimento esperado."
        action={
          yardeni ? (
            <Badge tone={TONE[yardeni.verdict]}>{VERDICT_LABELS[yardeni.verdict]}</Badge>
          ) : undefined
        }
      >
        {yardeni ? (
          <StepList
            rows={[
              {
                label: "Obrigações Aaa (aproximação)",
                formula: "Treasury a 10 anos + spread AAA do Damodaran",
                value: pct(yardeni.corporateBondYield, 2),
              },
              {
                label: "Crescimento dos lucros a longo prazo (LTEG)",
                formula: `Consenso a 5 anos do mercado dos EUA (Damodaran, ${DAMODARAN_UPDATED})`,
                value: pct(yardeni.longTermGrowth, 1),
              },
              {
                label: "P/E justo",
                formula: "1 ÷ (Aaa − 0,1 × LTEG)",
                value: mult(yardeni.fairPE),
                strong: true,
              },
              { label: "P/E atual", value: mult(yardeni.currentPE) },
              { label: "Mercado face ao justo", value: signedPct(yardeni.gap), strong: true },
            ]}
          />
        ) : (
          <Explainer>
            O modelo não tem solução com as taxas atuais (rendimento das obrigações demasiado
            baixo).
          </Explainer>
        )}
      </Card>

      <Card
        title="Damodaran: custo do capital e risco do país"
        description={`Dados de referência do Prof. Aswath Damodaran (NYU Stern), atualização de ${DAMODARAN_UPDATED}.`}
      >
        <h3 className="text-[12.5px] font-semibold text-muted-foreground">País: {c.country}</h3>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Rating soberano" value={c.rating ?? "—"} />
          <Stat label="Spread de incumprimento" value={pct(c.defaultSpread, 2)} />
          <Stat label="Prémio do país (CRP)" value={pct(c.crp, 2)} />
          <Stat
            label="ERP total"
            value={pct(c.erp, 2)}
            hint="ERP de um mercado maduro + prémio do país."
          />
          <Stat label="IRC marginal" value={pct(c.taxRate, 1)} />
        </div>
        <h3 className="mt-4 text-[12.5px] font-semibold text-muted-foreground">
          Indústria de referência: {ind.name} ({formatNumber(ind.firms, 0)} empresas dos EUA)
        </h3>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Beta" value={formatNumber(ind.beta ?? 0, 2)} />
          <Stat label="Beta sem dívida" value={formatNumber(ind.unleveredBeta ?? 0, 2)} />
          <Stat label="Custo do capital" value={pct(ind.costOfCapital, 2)} />
          <Stat label="Margem operacional" value={pct(ind.operatingMargin)} />
          <Stat label="EV/EBITDA" value={mult(ind.evEbitda)} />
          <Stat label="P/E" value={mult(ind.pe)} />
        </div>
        <h3 className="mt-4 text-[12.5px] font-semibold text-muted-foreground">
          Taxas sem risco a 10 anos
        </h3>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Treasury dos EUA" value={pct(data.macro.us10y, 2)} />
          <Stat label="Zona euro (curva AAA do BCE)" value={pct(data.macro.euro10y, 2)} />
          <Stat label="Usada nesta empresa" value={pct(a.assumptions.riskFree, 2)} />
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Fonte:{" "}
          <a
            className="text-primary hover:underline"
            href={DAMODARAN_URL}
            target="_blank"
            rel="noreferrer"
          >
            pages.stern.nyu.edu/~adamodar
          </a>
          .{" "}
          {a.context.industry.match === "industria"
            ? "Indústria identificada pela atividade da empresa."
            : a.context.industry.match === "setor"
              ? "Indústria aproximada pelo setor."
              : "Sem indústria correspondente: usa-se o mercado total."}
        </p>
      </Card>
    </div>
  );
}
