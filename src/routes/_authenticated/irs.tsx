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
import { formatDatePt, formatEUR, formatPct, formatQuantity, parseNumberPt } from "@/lib/format";

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
  const [rateText, setRateText] = useState("");
  const rate = parseNumberPt(rateText);
  const marginalRate = rateText.trim() !== "" && rate > 0 && rate < 100 ? rate / 100 : null;
  const rateError =
    rateText.trim() !== "" && !(rate > 0 && rate < 100)
      ? "Indica a taxa marginal entre 0 e 100 (ex.: 35,5)."
      : undefined;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tax", year, marginalRate],
    queryFn: () => fetchTax({ data: { year, marginalRate } }),
  });

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
      cell: (l) => formatEUR(l.acquisitionValue, hidden),
    },
    {
      id: "realValue",
      header: "Valor realização",
      align: "right",
      sortValue: (l) => l.realizationValue,
      cell: (l) => formatEUR(l.realizationValue, hidden),
    },
    {
      id: "expenses",
      header: "Despesas",
      align: "right",
      defaultHidden: true,
      sortValue: (l) => l.expenses,
      cell: (l) => formatEUR(l.expenses, hidden),
    },
    {
      id: "gain",
      header: "Mais/menos-valia",
      align: "right",
      required: true,
      sortValue: (l) => l.gain,
      cell: (l) => (
        <span className="flex flex-col items-end">
          <Delta value={l.gain}>{formatEUR(l.gain, hidden)}</Delta>
          {l.shortTerm && <Badge tone="warn">&lt; 365 dias</Badge>}
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
          {formatEUR(l.gain, hidden)}
        </Delta>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Aquisição</dt>
          <dd className="num font-medium">
            {formatDatePt(l.acquisitionDate)} · {formatEUR(l.acquisitionValue, hidden)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Realização</dt>
          <dd className="num font-medium">
            {formatDatePt(l.realizationDate)} · {formatEUR(l.realizationValue, hidden)}
          </dd>
        </div>
      </dl>
      {l.shortTerm && <Badge tone="warn">Detido há menos de 365 dias</Badge>}
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
      cell: (l) => formatEUR(l.gross, hidden),
    },
    {
      id: "tax",
      header: "Imposto retido",
      align: "right",
      sortValue: (l) => l.taxWithheld,
      cell: (l) => formatEUR(l.taxWithheld, hidden),
    },
    {
      id: "net",
      header: "Líquido",
      align: "right",
      sortValue: (l) => l.net,
      cell: (l) => (
        <span>
          {formatEUR(l.net, hidden)}
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
          <p className="num font-semibold">{formatEUR(l.gross, hidden)}</p>
          <p className="num text-xs text-muted-foreground">
            retido {formatEUR(l.taxWithheld, hidden)}
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
              data && downloadTextFile(`resumo-fiscal-${year}.csv`, taxReportCsv(data))
            }
          >
            <Download aria-hidden className="h-4 w-4" />
            Exportar CSV
          </Button>
        }
      />

      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:max-w-xl">
          <Field label="Ano fiscal">
            <SelectInput value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field
            label="Taxa marginal de IRS (%)"
            error={rateError}
            hint="Opcional: simula o englobamento."
          >
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
              placeholder="ex.: 35,5"
            />
          </Field>
        </div>
      </Card>

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading || !data || !t ? (
        <KpiGridSkeleton count={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
            <MetricCard
              label="Mais-valias líquidas"
              value={formatEUR(t.netGains, hidden)}
              sub={`realização ${formatEUR(t.realizationValue, hidden)}`}
              tone={t.netGains > 0 ? "positive" : t.netGains < 0 ? "negative" : "default"}
            />
            <MetricCard
              label="Dividendos brutos"
              value={formatEUR(t.dividendsGross, hidden)}
              sub={`líquidos ${formatEUR(t.dividendsNet, hidden)}`}
            />
            <MetricCard
              label="Imposto retido na fonte"
              value={formatEUR(t.dividendsTaxWithheld, hidden)}
              sub="dividendos"
            />
            <MetricCard
              label="Estimativa de imposto"
              value={formatEUR(data.autonomous.total, hidden)}
              sub={`tributação autónoma a 28 %${
                data.aggregated
                  ? ` · englobamento ${formatPct(data.aggregated.marginalRate * 100, 1)}: ${formatEUR(data.aggregated.total, hidden)}`
                  : ""
              }`}
            />
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
