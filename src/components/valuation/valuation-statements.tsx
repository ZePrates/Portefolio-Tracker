import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui-bits";
import { formatDatePt } from "@/lib/format";
import type { AnnualStatements, CompanyData } from "@/lib/valuation/types";
import { Explainer, SimpleTable } from "@/components/valuation/bits";
import { big, num } from "@/components/valuation/format";

type Line = [label: string, key: keyof AnnualStatements, kind?: "shares"];

const INCOME: Line[] = [
  ["Receita", "revenue"],
  ["Custo das vendas", "costOfRevenue"],
  ["Margem bruta", "grossProfit"],
  ["Gastos gerais (SG&A)", "sga"],
  ["Investigação e desenvolvimento", "rnd"],
  ["EBITDA", "ebitda"],
  ["Amortizações", "depreciation"],
  ["Resultado operacional (EBIT)", "operatingIncome"],
  ["Juros", "interestExpense"],
  ["Resultado antes de impostos", "pretaxIncome"],
  ["Impostos", "taxProvision"],
  ["Resultado líquido", "netIncome"],
  ["Ações (média diluída)", "dilutedShares", "shares"],
];

const BALANCE: Line[] = [
  ["Ativo total", "totalAssets"],
  ["Ativo corrente", "currentAssets"],
  ["Caixa e aplicações", "cash"],
  ["Clientes", "receivables"],
  ["Inventários", "inventory"],
  ["Ativo fixo tangível", "netPPE"],
  ["Passivo total", "totalLiabilities"],
  ["Passivo corrente", "currentLiabilities"],
  ["Fornecedores", "payables"],
  ["Dívida total", "totalDebt"],
  ["Dívida de curto prazo", "currentDebt"],
  ["Dívida de longo prazo", "longTermDebt"],
  ["Capital próprio", "equity"],
  ["Resultados transitados", "retainedEarnings"],
  ["Interesses minoritários", "minorityInterest"],
  ["Ações emitidas", "sharesOutstanding", "shares"],
];

const CASHFLOW: Line[] = [
  ["Fluxo de caixa operacional", "operatingCashFlow"],
  ["Investimento (capex)", "capex"],
  ["Fluxo de caixa livre", "freeCashFlow"],
  ["Remuneração em ações", "stockCompensation"],
  ["Dividendos pagos", "dividendsPaid"],
  ["Recompra de ações", "buybacks"],
  ["Mais-valias em ativos", "gainOnSale"],
];

function StatementTable({
  title,
  lines,
  data,
}: {
  title: string;
  lines: Line[];
  data: CompanyData;
}) {
  const s = data.statements;
  const cur = data.market.currency;
  const rows = lines
    .filter(([, key]) => (s[key] as (number | null)[]).some((v) => v != null))
    .map(([label, key, kind]) => [
      label,
      ...(s[key] as (number | null)[]).map((v) =>
        kind === "shares" ? (v == null ? "—" : `${num(v / 1e6, 1)} M`) : big(v, cur),
      ),
    ]);
  return (
    <Card title={title}>
      <SimpleTable firstColWide head={["", ...s.periods.map((p) => p.slice(0, 4))]} rows={rows} />
    </Card>
  );
}

export function ValuationStatements({ data }: { data: CompanyData }) {
  const p = data.profile;
  return (
    <div className="space-y-6">
      <Explainer>
        Contas anuais do Yahoo Finance (anos fiscais terminados a{" "}
        {data.statements.periods.map((x) => formatDatePt(x)).join(", ")}), em {data.market.currency}
        {p.financialCurrency !== data.market.currency &&
          `, convertidas de ${p.financialCurrency} ao câmbio de hoje`}
        . Confirma sempre no relatório oficial da empresa.
      </Explainer>
      <StatementTable title="Demonstração de resultados" lines={INCOME} data={data} />
      <StatementTable title="Balanço" lines={BALANCE} data={data} />
      <StatementTable title="Fluxos de caixa" lines={CASHFLOW} data={data} />
    </div>
  );
}

export function ValuationNews({ data }: { data: CompanyData }) {
  if (!data.news.length) {
    return <Explainer>Sem notícias recentes no Yahoo Finance para este símbolo.</Explainer>;
  }
  return (
    <Card title="Notícias recentes" description="Do Yahoo Finance. Abrem no site de origem.">
      <ul className="divide-y divide-border">
        {data.news.map((n) => (
          <li key={n.url} className="py-2.5">
            <a
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start justify-between gap-3"
            >
              <span className="text-[13.5px] font-medium group-hover:text-primary" lang="en">
                {n.title}
              </span>
              <ExternalLink
                aria-hidden
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            </a>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {[n.publisher, n.publishedAt ? formatDatePt(n.publishedAt) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
