import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Download, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Delta,
  ErrorState,
  Field,
  KpiGridSkeleton,
  MetricCard,
  PageHeader,
  SelectInput,
  TextInput,
} from "@/components/ui-bits";
import { DataTable, type Column } from "@/components/data-table";
import { usePrivateMode } from "@/components/private-mode";
import { getTaxReport } from "@/lib/tax.functions";
import type { CapitalGainLine, DividendTaxLine } from "@/lib/tax-report";
import { taxReportCsv } from "@/lib/csv";
import { downloadTextFile } from "@/lib/download";
import { formatDatePt, formatPct, formatQuantity } from "@/lib/format";
import { privateEUR } from "@/components/private-value";
import { TaxYearOptionsPanel } from "@/components/tax-year-options";
import { TaxDocumentsPanel, useTaxDocuments } from "@/components/tax-documents-panel";
import { hasOfficialTotals, reconcileDocument } from "@/lib/tax-rules";

const FIXED_NOTICES = [
  "A exclusão parcial por detenção (art. 43.º, n.º 5) é calculada por lote; confirma com o contabilista a aplicação a lotes adquiridos antes de 2025.",
  "Anexo G ou J para o XTB: confirma no relatório do XTB (há sucursal em Portugal).",
  "Englobamento de dividendos a 50 % (art. 40.º-A): aplica-se a lucros distribuídos por entidades residentes em PT/UE/EEE; confirma para distribuições de ETFs.",
  "FIFO por entidade depositária (art. 43.º, n.º 9): a app aplica FIFO por ativo — correto enquanto cada ativo estiver num só broker.",
];

export const Route = createFileRoute("/_authenticated/irs")({
  head: () => ({
    meta: [
      { title: "Resumo fiscal (IRS) — Portefólio Tracker" },
      {
        name: "description",
        content:
          "Mais-valias (método FIFO) e dividendos do ano, organizados pelos Anexos G, J e E do IRS, com estimativa de imposto.",
      },
    ],
  }),
  component: IrsPage,
});

const ANNEX_LABEL = { G: "Anexo G", J: "Anexo J", E: "Anexo E" } as const;

function IrsPage() {
  const { hidden } = usePrivateMode();
  const fetchTax = useServerFn(getTaxReport);
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 7 }, (_, i) => thisYear - i), [thisYear]);

  const [year, setYear] = useState(thisYear);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tax", year],
    queryFn: () => fetchTax({ data: { year, marginalRate: null } }),
  });
  const docsQuery = useTaxDocuments(year);
  const documents = docsQuery.data ?? [];
  const hasXtbTotals = documents.some((d) => d.source === "xtb" && hasOfficialTotals(d));

  const gainColumns: Column<CapitalGainLine>[] = [
    {
      id: "asset",
      header: "Ativo",
      required: true,
      sortValue: (l) => l.assetName.toLowerCase(),
      cell: (l) => (
        <div className="max-w-[18rem]">
          <p className="font-medium">{l.assetName}</p>
          <p className="text-xs text-muted-foreground">
            {ANNEX_LABEL[l.annex]} · {l.code}
            {l.country ? ` · ${l.country}` : ""}
            {l.isin ? ` · ${l.isin}` : ""}
          </p>
        </div>
      ),
    },
    {
      id: "acq",
      header: "Aquisição",
      sortValue: (l) => l.acquisitionDate,
      cell: (l) => formatDatePt(l.acquisitionDate),
    },
    {
      id: "real",
      header: "Realização",
      sortValue: (l) => l.realizationDate,
      cell: (l) => formatDatePt(l.realizationDate),
    },
    {
      id: "qty",
      header: "Qtd.",
      align: "right",
      sortValue: (l) => l.quantity,
      cell: (l) => formatQuantity(l.quantity),
    },
    {
      id: "acqValue",
      header: "Valor aquisição",
      align: "right",
      sortValue: (l) => l.acquisitionValue,
      cell: (l) => privateEUR(l.acquisitionValue, hidden),
    },
    {
      id: "realValue",
      header: "Valor realização",
      align: "right",
      sortValue: (l) => l.realizationValue,
      cell: (l) => privateEUR(l.realizationValue, hidden),
    },
    {
      id: "expenses",
      header: "Despesas",
      align: "right",
      defaultHidden: true,
      sortValue: (l) => l.expenses,
      cell: (l) => privateEUR(l.expenses, hidden),
    },
    {
      id: "gain",
      header: "Mais/menos-valia",
      align: "right",
      required: true,
      sortValue: (l) => l.gain,
      cell: (l) => (
        <span className="flex flex-col items-end gap-0.5">
          <Delta value={l.gain}>{privateEUR(l.gain, hidden)}</Delta>
          {l.shortTerm && <Badge tone="warn">&lt; 365 dias</Badge>}
          {l.excludedPct > 0 && (
            <Badge tone="info">−{Math.round(l.excludedPct * 100)} % (art. 43.º/5)</Badge>
          )}
        </span>
      ),
    },
    {
      id: "taxable",
      header: "Ganho tributável",
      align: "right",
      sortValue: (l) => l.taxableGain,
      cell: (l) => (
        <span className="flex flex-col items-end">
          {privateEUR(l.taxableGain, hidden)}
          <span className="text-xs text-muted-foreground">
            {l.holdingYears} {l.holdingYears === 1 ? "ano" : "anos"}
          </span>
        </span>
      ),
    },
  ];

  const gainCard = (l: CapitalGainLine) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{l.assetName}</p>
          <p className="text-xs text-muted-foreground">
            {ANNEX_LABEL[l.annex]} · {l.code}
            {l.country ? ` · ${l.country}` : ""}
          </p>
        </div>
        <Delta value={l.gain} className="shrink-0">
          {privateEUR(l.gain, hidden)}
        </Delta>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Aquisição</dt>
          <dd className="num font-medium">
            {formatDatePt(l.acquisitionDate)} · {privateEUR(l.acquisitionValue, hidden)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Realização</dt>
          <dd className="num font-medium">
            {formatDatePt(l.realizationDate)} · {privateEUR(l.realizationValue, hidden)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-1">
        {l.shortTerm && <Badge tone="warn">Detido há menos de 365 dias</Badge>}
        {l.excludedPct > 0 && (
          <Badge tone="info">
            −{Math.round(l.excludedPct * 100)} % (art. 43.º/5) · tributável{" "}
            {privateEUR(l.taxableGain, hidden)}
          </Badge>
        )}
      </div>
    </div>
  );

  const dividendColumns: Column<DividendTaxLine>[] = [
    {
      id: "asset",
      header: "Ativo",
      required: true,
      sortValue: (l) => l.assetName.toLowerCase(),
      cell: (l) => (
        <div>
          <p className="font-medium">{l.assetName}</p>
          <p className="text-xs text-muted-foreground">
            {ANNEX_LABEL[l.annex]} · {l.code}
            {l.country ? ` · ${l.country}` : ""} · {l.count}{" "}
            {l.count === 1 ? "pagamento" : "pagamentos"}
          </p>
        </div>
      ),
    },
    {
      id: "gross",
      header: "Bruto",
      align: "right",
      sortValue: (l) => l.gross,
      cell: (l) => privateEUR(l.gross, hidden),
    },
    {
      id: "tax",
      header: "Imposto retido",
      align: "right",
      sortValue: (l) => l.taxWithheld,
      cell: (l) => privateEUR(l.taxWithheld, hidden),
    },
    {
      id: "net",
      header: "Líquido",
      align: "right",
      sortValue: (l) => l.net,
      cell: (l) => (
        <span>
          {privateEUR(l.net, hidden)}
          {l.hasEstimatedDates && (
            <span className="block">
              <Badge tone="warn">datas estimadas</Badge>
            </span>
          )}
        </span>
      ),
    },
  ];

  const dividendCard = (l: DividendTaxLine) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{l.assetName}</p>
          <p className="text-xs text-muted-foreground">
            {ANNEX_LABEL[l.annex]} · {l.code}
            {l.country ? ` · ${l.country}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num font-semibold">{privateEUR(l.gross, hidden)}</p>
          <p className="num text-xs text-muted-foreground">
            retido {privateEUR(l.taxWithheld, hidden)}
          </p>
        </div>
      </div>
      {l.hasEstimatedDates && <Badge tone="warn">datas de pagamento estimadas</Badge>}
    </div>
  );

  const t = data?.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resumo fiscal (IRS)"
        subtitle="Mais-valias pelo método FIFO e dividendos do ano, organizados pelos Anexos G, J e E."
        actions={
          <Button
            variant="outline"
            disabled={!data}
            onClick={() =>
              data &&
              downloadTextFile(
                `resumo-fiscal-${year}.csv`,
                taxReportCsv(
                  data,
                  documents.map((d) => ({
                    ...d,
                    reconciliation: hasOfficialTotals(d) ? reconcileDocument(d, data.bySource) : [],
                  })),
                ),
              )
            }
          >
            <Download aria-hidden className="h-4 w-4" />
            Exportar CSV
          </Button>
        }
      />

      <Card>
        <div className="max-w-xs">
          <Field label="Ano fiscal">
            <SelectInput value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
      </Card>

      {data && (
        <TaxYearOptionsPanel
          key={`${year}-${data.settings?.updated_at ?? "novo"}`}
          year={year}
          settings={data.settings}
          onSaved={() => void refetch()}
        />
      )}

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading || !data || !t ? (
        <KpiGridSkeleton count={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
            <MetricCard
              label="Mais-valias líquidas"
              value={privateEUR(t.netGains, hidden)}
              sub={
                <>
                  tributável {privateEUR(t.taxableNetGains, hidden)} · realização{" "}
                  {privateEUR(t.realizationValue, hidden)}
                </>
              }
              tone={t.netGains > 0 ? "positive" : t.netGains < 0 ? "negative" : "default"}
            />
            <MetricCard
              label="Dividendos brutos"
              value={privateEUR(t.dividendsGross, hidden)}
              sub={<>líquidos {privateEUR(t.dividendsNet, hidden)}</>}
            />
            <MetricCard
              label="Imposto retido na fonte"
              value={privateEUR(t.dividendsTaxWithheld, hidden)}
              sub="dividendos"
            />
            <MetricCard
              label="Estimativa de imposto"
              value={
                data.estimate.total == null ? "Sem dados" : privateEUR(data.estimate.total, hidden)
              }
              sub={
                <>
                  {data.estimate.mode === "aggregated"
                    ? "com englobamento"
                    : data.estimate.mode === "mixed"
                      ? "autónoma + englobamento obrigatório"
                      : "tributação autónoma a 28 %"}
                  {data.estimate.mode !== "autonomous" && (
                    <> · autónoma {privateEUR(data.autonomous.total, hidden)}</>
                  )}
                  {data.aggregated && (
                    <>
                      {" "}
                      · englobamento {formatPct(data.aggregated.marginalRate * 100, 1)}:{" "}
                      {privateEUR(data.aggregated.total, hidden)}
                    </>
                  )}
                </>
              }
            />
          </div>

          {hasXtbTotals && (
            <div className="rounded-lg border border-info/40 bg-info/10 p-3 text-sm">
              Tens um relatório oficial do XTB com totais: usa os valores oficiais na declaração e
              vê a reconciliação em "Relatórios oficiais {year}".
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-3 text-sm">
              <p className="font-medium">
                Menos-valias reportadas disponíveis:{" "}
                {privateEUR(data.lossCarryforward.available, hidden)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {data.optedAggregation
                  ? `Aplicadas em ${year}: `
                  : "Só podem ser usadas em anos com englobamento (5 anos). "}
                {data.optedAggregation && privateEUR(data.lossCarryforward.applied, hidden)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-sm">
              <p className="font-medium">Englobamento obrigatório (&lt; 365 dias)</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {data.mandatoryAggregation == null
                  ? "Indica o rendimento coletável nas opções do ano para verificar."
                  : data.mandatoryAggregation.applies
                    ? "Aplica-se: o saldo de curto prazo é englobado à taxa marginal."
                    : "Não se aplica neste ano."}{" "}
                {data.mandatoryAggregation && (
                  <>
                    Limite do último escalão:{" "}
                    {privateEUR(data.mandatoryAggregation.threshold, false)}
                  </>
                )}
              </p>
            </div>
          </div>

          {data.warnings.length > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
            >
              <p className="flex items-center gap-2 font-medium">
                <TriangleAlert aria-hidden className="h-4 w-4 text-warning" />
                Avisos
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
                {data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <section aria-labelledby="irs-gains" className="space-y-3">
            <h2 id="irs-gains" className="text-base font-semibold">
              Mais-valias {year} ({data.capitalGains.length})
            </h2>
            {data.capitalGains.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
                Sem vendas em {year}: não há mais-valias a declarar.
              </p>
            ) : (
              <DataTable
                rows={data.capitalGains}
                columns={gainColumns}
                rowKey={(l) =>
                  `${l.assetId}-${l.acquisitionDate}-${l.realizationDate}-${l.quantity}`
                }
                caption={`Mais-valias de ${year} por lote`}
                storageKey="irs-gains"
                defaultSort={{ id: "real", dir: "asc" }}
                searchText={(l) => `${l.assetName} ${l.isin ?? ""}`}
                pageSize={25}
                renderCard={gainCard}
              />
            )}
          </section>

          <section aria-labelledby="irs-divs" className="space-y-3">
            <h2 id="irs-divs" className="text-base font-semibold">
              Dividendos {year} ({data.dividends.length})
            </h2>
            {data.dividends.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
                Sem dividendos recebidos em {year}.
              </p>
            ) : (
              <DataTable
                rows={data.dividends}
                columns={dividendColumns}
                rowKey={(l) => `${l.assetId ?? l.assetName}-${l.code}`}
                caption={`Dividendos de ${year} por ativo`}
                defaultSort={{ id: "gross", dir: "desc" }}
                pageSize={25}
                renderCard={dividendCard}
              />
            )}
          </section>

          {(data.interest.length > 0 || data.bonuses.length > 0) && (
            <section aria-labelledby="irs-p2p" className="space-y-3">
              <h2 id="irs-p2p" className="text-base font-semibold">
                Juros P2P {year}
              </h2>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {data.interest.map((l) => (
                  <li
                    key={`${l.assetId ?? l.assetName}-${l.code}`}
                    className="flex items-start justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium leading-snug">{l.assetName}</p>
                      <p className="text-xs text-muted-foreground">
                        {ANNEX_LABEL[l.annex]} · quadro 8A · {l.code} (juros sem retenção em
                        Portugal){l.country ? ` · ${l.country}` : ""} · {l.count}{" "}
                        {l.count === 1 ? "pagamento" : "pagamentos"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num font-semibold">{privateEUR(l.gross, hidden)}</p>
                      <p className="num text-xs text-muted-foreground">
                        imposto a 28 % {privateEUR(l.gross * 0.28, hidden)}
                      </p>
                    </div>
                  </li>
                ))}
                {data.bonuses.map((b) => (
                  <li
                    key={`bonus-${b.assetId ?? b.assetName}`}
                    className="flex items-start justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium leading-snug">{b.assetName} · bónus</p>
                      <p className="text-xs text-muted-foreground">
                        Fora do total de juros: confirma o enquadramento antes de declarar.
                      </p>
                    </div>
                    <p className="num shrink-0 font-semibold">{privateEUR(b.amount, hidden)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <TaxDocumentsPanel
            year={year}
            appTotals={data.bySource}
            hidden={hidden}
            documents={documents}
            onChanged={() => void docsQuery.refetch()}
          />

          <div className="rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Notas importantes</p>
            <ul className="list-inside list-disc space-y-0.5">
              {FIXED_NOTICES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            Estimativa informativa calculada com os dados registados nesta app (câmbio da data de
            cada operação, método FIFO). Não substitui a declaração oficial nem aconselhamento
            fiscal: confirma os valores com o extrato do broker e com um contabilista antes de
            entregar o IRS.
          </p>
        </>
      )}
    </div>
  );
}
