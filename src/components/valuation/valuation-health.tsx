import { Badge, Card } from "@/components/ui-bits";
import { formatNumber } from "@/lib/format";
import type { CompanyAnalysis } from "@/lib/valuation/analyze";
import { BALANCE_EXPLANATIONS, BALANCE_LABELS, type AltmanZone } from "@/lib/valuation/health";
import { isNum } from "@/lib/valuation/stats";
import type { CompanyData } from "@/lib/valuation/types";
import {
  Explainer,
  PassMark,
  ScorePill,
  SimpleTable,
  Stat,
  StepList,
} from "@/components/valuation/bits";
import { big, mult, num, pct, signedPct } from "@/components/valuation/format";

const ZONE: Record<AltmanZone, { label: string; tone: "gain" | "warn" | "loss" }> = {
  segura: { label: "Zona segura", tone: "gain" },
  cinzenta: { label: "Zona cinzenta", tone: "warn" },
  perigo: { label: "Zona de perigo", tone: "loss" },
};

export function ValuationHealth({
  data,
  analysis: a,
}: {
  data: CompanyData;
  analysis: CompanyAnalysis;
}) {
  const h = a.health;
  return (
    <div className="space-y-6">
      <Card
        title="Nota de saúde financeira"
        action={<ScorePill score={h.score.score} label="Saúde financeira" />}
        description="Se o balanço aguenta, se os lucros se transformam em caixa e qual o risco de falência."
      >
        <SimpleTable
          head={["Componente", "Pontos", "Máximo"]}
          rows={h.score.parts.map((p) => [
            p.label,
            formatNumber(p.points, 1),
            formatNumber(p.max, 0),
          ])}
        />
      </Card>
      <AltmanCard data={data} a={a} />
      <PiotroskiCard a={a} />
      <BeneishCard a={a} />
      <QualityCard a={a} data={data} />
      <DupontCard a={a} />
      <BalanceCard a={a} data={data} />
    </div>
  );
}

function AltmanCard({ data, a }: { data: CompanyData; a: CompanyAnalysis }) {
  const alt = a.health.altman;
  if (!a.health.altmanApplicable) {
    return (
      <Card title="Altman Z-Score: risco de falência">
        <Explainer>
          O Z-Score foi calibrado em empresas industriais e de serviços. Não se aplica a bancos nem
          a REITs, cujo balanço tem outra estrutura (dívida como matéria-prima, imóveis ao custo).
        </Explainer>
      </Card>
    );
  }
  if (!alt) {
    return (
      <Card title="Altman Z-Score: risco de falência">
        <Explainer>
          Faltam linhas do balanço (ativo/passivo corrente ou resultados) para calcular o Z-Score.
        </Explainer>
      </Card>
    );
  }
  const z = ZONE[alt.zone];
  const original = alt.model === "original";
  const rows = original
    ? [
        ["A", "1,2", "Fundo de maneio ÷ ativo", alt.x1],
        ["B", "1,4", "Resultados transitados ÷ ativo", alt.x2],
        ["C", "3,3", "EBIT ÷ ativo", alt.x3],
        ["D", "0,6", "Capitalização ÷ passivo", alt.x4],
        ["E", "1,0", "Vendas ÷ ativo", alt.x5],
      ]
    : [
        ["A", "6,56", "Fundo de maneio ÷ ativo", alt.x1],
        ["B", "3,26", "Resultados transitados ÷ ativo", alt.x2],
        ["C", "6,72", "EBIT ÷ ativo", alt.x3],
        ["D", "1,05", "Capital próprio ÷ passivo", alt.x4],
      ];
  return (
    <Card
      title="Altman Z-Score: risco de falência"
      description="Cinco rácios ponderados que, em conjunto, anteciparam falências até dois anos antes."
      action={<Badge tone={z.tone}>{z.label}</Badge>}
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="num text-3xl font-bold">{formatNumber(alt.score, 2)}</p>
        <p className="text-[12.5px] text-muted-foreground">
          Modelo {original ? "original (indústria)" : "Z'' (serviços e mercados emergentes)"} ·
          original {num(alt.original)} · Z'' {num(alt.z2)}
        </p>
      </div>
      <SimpleTable
        className="mt-3"
        head={["", "Peso", "Rácio", "Valor", "Contributo"]}
        rows={rows.map(([l, w, d, v]) => [
          l as string,
          w as string,
          d as string,
          num(v as number | null, 3),
          isNum(v) ? formatNumber(Number(String(w).replace(",", ".")) * (v as number), 3) : "—",
        ])}
      />
      <p className="mt-3 text-[12px] text-muted-foreground">
        {original
          ? "Original: acima de 2,99 zona segura; entre 1,81 e 2,99 zona cinzenta; abaixo de 1,81 risco elevado."
          : "Z'': acima de 2,6 zona segura; entre 1,1 e 2,6 zona cinzenta; abaixo de 1,1 risco elevado."}{" "}
        Capitalização usada: {big(data.market.marketCap, data.market.currency)}.
      </p>
    </Card>
  );
}

function PiotroskiCard({ a }: { a: CompanyAnalysis }) {
  const hist = a.health.piotroski;
  const last = hist[hist.length - 1];
  if (!last) {
    return (
      <Card title="Piotroski F-Score">
        <Explainer>Precisa de pelo menos dois anos de contas comparáveis.</Explainer>
      </Card>
    );
  }
  const groups = ["Rentabilidade", "Estrutura e liquidez", "Eficiência"] as const;
  return (
    <Card
      title="Piotroski F-Score: evolução da saúde financeira"
      description="Nove testes de 0 ou 1 ponto: a empresa está a melhorar face ao ano anterior? 8–9 é forte, 0–3 é fraco."
      action={<ScorePill score={last.score} max={9} label="F-Score" />}
    >
      {groups.map((g) => (
        <div key={g} className="mt-2">
          <h3 className="text-[12.5px] font-semibold text-muted-foreground">{g}</h3>
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
            {last.criteria
              .filter((c) => c.group === g)
              .map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]"
                >
                  <span className="flex items-center gap-2">
                    <PassMark pass={c.pass} />
                    {c.label}
                  </span>
                  <span className="num shrink-0 text-[12px] text-muted-foreground">{c.detail}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="mt-3 text-[12px] text-muted-foreground">
        Evolução:{" "}
        {hist.map((p) => `${p.period.slice(0, 4)}: ${p.score}/${p.available}`).join(" · ")}
        {last.available < 9 && " · os critérios sem dados não contam para o máximo."}
      </p>
    </Card>
  );
}

const BENEISH_LABELS: Record<string, string> = {
  dsri: "Dias de clientes (DSRI)",
  gmi: "Margem bruta (GMI)",
  aqi: "Qualidade do ativo (AQI)",
  sgi: "Crescimento das vendas (SGI)",
  depi: "Amortizações (DEPI)",
  sgai: "Gastos gerais (SGAI)",
  lvgi: "Endividamento (LVGI)",
  tata: "Acréscimos ÷ ativo (TATA)",
};

function BeneishCard({ a }: { a: CompanyAnalysis }) {
  const b = a.health.beneish;
  const q = a.health.quality;
  return (
    <Card
      title="Qualidade da informação financeira"
      description="Os lucros são reais? Compara o lucro com o caixa e procura padrões típicos de contas embelezadas (Beneish M-Score)."
      action={
        b ? (
          <Badge tone={b.flagged ? "warn" : "gain"}>
            {b.flagged ? "Sinais a vigiar" : "Sem sinais de alerta"}
          </Badge>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Caixa operacional ÷ lucro"
          value={mult(q.cashConversion, 2)}
          hint="Acima de 1: o lucro transforma-se em caixa."
        />
        <Stat label="FCF ÷ lucro" value={mult(q.fcfConversion, 2)} />
        <Stat label="Caixa operacional ÷ EBITDA" value={pct(q.cfoToEbitda, 0)} />
        <Stat
          label="Acréscimos (Sloan)"
          value={pct(q.accrualsRatio)}
          hint="(Lucro − caixa operacional) ÷ ativo médio. Acima de 5 % o lucro depende muito de estimativas contabilísticas."
          tone={isNum(q.accrualsRatio) && q.accrualsRatio > 0.05 ? "negative" : "default"}
        />
      </div>
      {b ? (
        <>
          <p className="mt-4 text-[13px]">
            M-Score <strong className="num">{formatNumber(b.score, 2)}</strong>{" "}
            <span className="text-muted-foreground">
              (acima de −1,78 há padrões compatíveis com manipulação de resultados)
            </span>
          </p>
          <SimpleTable
            className="mt-2"
            head={["Índice", "Valor"]}
            rows={Object.entries(b.indices).map(([k, v]) => [BENEISH_LABELS[k] ?? k, num(v, 3)])}
          />
          {isNum(b.indices.sgi) && b.indices.sgi > 1.3 && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              As vendas cresceram {signedPct(b.indices.sgi - 1, 0)}: o M-Score penaliza o
              crescimento rápido, por isso em empresas de crescimento é comum dar sinal sem haver
              problema.
            </p>
          )}
          {b.missing.length > 0 && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              Sem dados (assumidos neutros): {b.missing.join(", ")}.
            </p>
          )}
        </>
      ) : (
        <Explainer>Sem dados suficientes para o M-Score.</Explainer>
      )}
    </Card>
  );
}

function QualityCard({ a, data }: { a: CompanyAnalysis; data: CompanyData }) {
  const q = a.health.quality;
  const cur = data.market.currency;
  return (
    <Card
      title="Rácios financeiros"
      description={`Último ano fiscal e tendência de ${q.years} anos.`}
    >
      <h3 className="text-[12.5px] font-semibold text-muted-foreground">Rentabilidade</h3>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Margem bruta" value={pct(q.grossMargin)} />
        <Stat label="Margem EBITDA" value={pct(q.ebitdaMargin)} />
        <Stat label="Margem operacional" value={pct(q.operatingMargin)} />
        <Stat label="Margem líquida" value={pct(q.netMargin)} />
        <Stat label="Margem FCF" value={pct(q.fcfMargin)} />
        <Stat label="ROE" value={pct(q.roe)} />
      </div>
      <h3 className="mt-4 text-[12.5px] font-semibold text-muted-foreground">
        Liquidez e solvência
      </h3>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Liquidez geral"
          value={num(q.currentRatio)}
          hint="Ativo corrente ÷ passivo corrente."
        />
        <Stat
          label="Liquidez reduzida"
          value={num(q.quickRatio)}
          hint="(Ativo corrente − inventários) ÷ passivo corrente."
        />
        <Stat label="Dívida ÷ capital próprio" value={mult(q.debtToEquity, 2)} />
        <Stat label="Dívida líquida" value={big(q.netDebt, cur)} />
        <Stat label="Cobertura de juros" value={mult(q.interestCoverage)} hint="EBIT ÷ juros." />
        <Stat
          label="Autonomia financeira"
          value={pct(q.equityToAssets)}
          hint="Capital próprio ÷ ativo."
        />
      </div>
      <h3 className="mt-4 text-[12.5px] font-semibold text-muted-foreground">
        Crescimento e ciclo
      </h3>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Receita (por ano)" value={signedPct(q.revenueCagr)} />
        <Stat label="Lucro por ação (por ano)" value={signedPct(q.epsCagr)} />
        <Stat label="FCF (por ano)" value={signedPct(q.fcfCagr)} />
        <Stat
          label="Nº de ações (por ano)"
          value={signedPct(q.shareChange)}
          tone={isNum(q.shareChange) && q.shareChange > 0.01 ? "negative" : "default"}
          hint="Positivo = diluição dos acionistas; negativo = recompras."
        />
        <Stat
          label="Capex ÷ amortizações"
          value={mult(q.capexToDepreciation, 2)}
          hint="Acima de 1 a empresa investe mais do que o desgaste dos ativos."
        />
        <Stat
          label="Ciclo de caixa (dias)"
          value={num(q.cashCycle, 0)}
          hint="Dias de clientes + inventários − fornecedores."
        />
      </div>
    </Card>
  );
}

function DupontCard({ a }: { a: CompanyAnalysis }) {
  const d = a.health.dupont;
  return (
    <Card
      title="DuPont: de onde vem o ROE"
      description="O retorno do capital próprio decomposto em margem, eficiência e alavancagem."
    >
      <StepList
        rows={[
          {
            label: "Carga fiscal",
            formula: "Resultado líquido ÷ resultado antes de impostos",
            value: pct(d.taxBurden),
          },
          {
            label: "Carga financeira",
            formula: "Resultado antes de impostos ÷ EBIT",
            value: pct(d.interestBurden),
          },
          { label: "Margem operacional", formula: "EBIT ÷ vendas", value: pct(d.ebitMargin) },
          { label: "Rotação do ativo", formula: "Vendas ÷ ativo", value: mult(d.assetTurnover, 2) },
          { label: "Alavancagem", formula: "Ativo ÷ capital próprio", value: mult(d.leverage, 2) },
          { label: "ROE", formula: "Produto dos cinco fatores", value: pct(d.roe), strong: true },
        ]}
      />
    </Card>
  );
}

function BalanceCard({ a, data }: { a: CompanyAnalysis; data: CompanyData }) {
  const b = a.health.balance;
  const cur = data.market.currency;
  if (!b) {
    return (
      <Card title="Equilíbrio financeiro">
        <Explainer>
          Sem ativo e passivo corrente nas contas (habitual nos bancos): não se aplica.
        </Explainer>
      </Card>
    );
  }
  const tone = b.state.startsWith("equilibrio")
    ? "gain"
    : b.state === "grande_distribuicao"
      ? "info"
      : b.state === "dependencia_bancaria"
        ? "warn"
        : "loss";
  return (
    <Card
      title="Equilíbrio financeiro"
      description="O balanço aguenta? Compara o fundo de maneio com as necessidades do ciclo de exploração."
      action={<Badge tone={tone}>{BALANCE_LABELS[b.state]}</Badge>}
    >
      <StepList
        rows={[
          {
            label: "Fundo de maneio (FM)",
            formula: "Ativo corrente − passivo corrente",
            value: big(b.workingCapital, cur),
          },
          {
            label: "Tesouraria líquida (TL)",
            formula: b.method === "direto" ? "Caixa − dívida de curto prazo" : "FM − NFM",
            value: big(b.netTreasury, cur),
          },
          {
            label: "Necessidades de fundo de maneio (NFM)",
            formula:
              b.method === "direto"
                ? "FM − TL (tudo o que é do ciclo de exploração)"
                : "Clientes + inventários − fornecedores",
            value: big(b.workingCapitalNeeds, cur),
            strong: true,
          },
        ]}
      />
      <p className="mt-3 text-[13px]">{BALANCE_EXPLANATIONS[b.state]}</p>
    </Card>
  );
}
