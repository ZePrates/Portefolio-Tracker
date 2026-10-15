import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidatePortfolio } from "@/lib/portfolio-queries";
import { useServerFn } from "@tanstack/react-start";
import { useId, useRef, useState } from "react";
import { FileUp, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MetricCard,
  PageHeader,
  useConfirm,
} from "@/components/ui-bits";
import { DataTable, type Column } from "@/components/data-table";
import { HistoryImportCard } from "@/components/history-import-card";
import { HistoryRebuildCard } from "@/components/history-rebuild-card";
import { usePrivateMode } from "@/components/private-mode";
import { commitXtbImport, previewXtbImport } from "@/lib/xtb.functions";
import {
  xtbRowsFromCsv,
  xtbRowsFromWorkbook,
  type DividendAction,
  type PlannedDividend,
  type PlannedTrade,
  type TradeAction,
  type XtbRawRow,
} from "@/lib/xtb";
import { readXlsx } from "@/lib/xlsx";
import { formatDatePt, formatNumber, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { privateEUR } from "@/components/private-value";

export const Route = createFileRoute("/_authenticated/importar")({
  head: () => ({
    meta: [
      { title: "Importar extrato XTB — Portefólio Tracker" },
      {
        name: "description",
        content:
          "Importa o extrato de operações da XTB com pré-visualização: concilia compras e vendas com o valor real em euros e confirma dividendos.",
      },
    ],
  }),
  component: ImportarPage,
});

const MAX_BYTES = 5_000_000;

/** Um extrato lido no browser: as operações de caixa de uma conta. */
interface StatementFile {
  name: string;
  account: string | null;
  currency: string;
  rows: XtbRawRow[];
}

/** Lê um extrato XTB em Excel (.xlsx) ou CSV ("Cash Operations"). */
async function readStatement(file: File): Promise<StatementFile> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: demasiado grande (máximo 5 MB).`);
  if (/\.xlsx$/i.test(file.name)) {
    const sheets = readXlsx(new Uint8Array(await file.arrayBuffer()));
    const acc = xtbRowsFromWorkbook(sheets, file.name);
    if (acc.rows.length === 0 && acc.errors.length > 0) {
      throw new Error(`${file.name}: ${acc.errors[0]!.message}`);
    }
    return { name: file.name, account: acc.account, currency: acc.currency, rows: acc.rows };
  }
  if (!/\.(csv|txt)$/i.test(file.name) && !file.type.includes("csv")) {
    throw new Error(`${file.name}: escolhe o Excel (.xlsx) ou o CSV exportado da XTB.`);
  }
  const parsed = xtbRowsFromCsv(await file.text());
  if (parsed.rows.length === 0 && parsed.errors.length > 0) {
    throw new Error(`${file.name}: ${parsed.errors[0]!.message}`);
  }
  // Sem resumo da conta no CSV: a moeda vem do nome ("USD_51628579_….csv") ou é EUR.
  const currency = /(?:^|[_-])([A-Z]{3})_\d+/.exec(file.name)?.[1] ?? "EUR";
  return { name: file.name, account: null, currency, rows: parsed.rows };
}

const TRADE_LABEL: Record<
  TradeAction,
  { label: string; tone: "info" | "primary" | "neutral" | "warn" | "loss" }
> = {
  insert: { label: "Novo", tone: "info" },
  reconcile: { label: "Conciliar", tone: "primary" },
  duplicate: { label: "Já importado", tone: "neutral" },
  unmatched: { label: "Sem ativo", tone: "warn" },
  blocked: { label: "Bloqueado", tone: "loss" },
};

const DIVIDEND_LABEL: Record<
  DividendAction,
  { label: string; tone: "info" | "primary" | "neutral" | "warn" }
> = {
  insert: { label: "Novo", tone: "info" },
  confirm: { label: "Confirma estimado", tone: "primary" },
  duplicate: { label: "Já importado", tone: "neutral" },
  unmatched: { label: "Sem ativo", tone: "warn" },
};

function ImportarPage() {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const previewFn = useServerFn(previewXtbImport);
  const commitFn = useServerFn(commitXtbImport);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<StatementFile[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const preview = useMutation({
    mutationFn: (list: StatementFile[]) => previewFn({ data: { files: list } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const commit = useMutation({
    mutationFn: (list: StatementFile[]) => commitFn({ data: { files: list } }),
    onSuccess: async (res) => {
      await invalidatePortfolio(queryClient);
      toast.success(
        `Importação concluída: ${res.recomputedAssets} ${
          res.recomputedAssets === 1 ? "posição recalculada" : "posições recalculadas"
        }.`,
      );
      // Volta a pré-visualizar para mostrar que tudo ficou "Já importado".
      if (files) preview.mutate(files);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const readFiles = async (list: File[]) => {
    setFileError(null);
    if (list.length === 0) return;
    try {
      const read = await Promise.all(list.map(readStatement));
      setFiles(read);
      commit.reset();
      preview.mutate(read);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Não foi possível ler o ficheiro.");
    }
  };

  const plan = preview.data?.plan;
  const toWrite = plan
    ? plan.summary.insert +
      plan.summary.reconcile +
      plan.summary.dividend_insert +
      plan.summary.dividend_confirm
    : 0;

  const runCommit = async () => {
    if (!files) return;
    const ok = await confirm({
      title: "Importar este extrato?",
      description: (
        <>
          Vão ser gravados {plan?.summary.insert ?? 0} movimentos novos, conciliados{" "}
          {plan?.summary.reconcile ?? 0} movimentos manuais (passam a ter o valor real em euros do
          broker) e tratados{" "}
          {(plan?.summary.dividend_insert ?? 0) + (plan?.summary.dividend_confirm ?? 0)} dividendos.
          Cada operação fica marcada com o ID da XTB, por isso repetir a importação não cria
          duplicados.
        </>
      ),
      confirmLabel: "Importar",
    });
    if (ok) commit.mutate(files);
  };

  const tradeColumns: Column<PlannedTrade>[] = [
    {
      id: "date",
      header: "Data",
      required: true,
      sortValue: (p) => p.trade.date,
      cell: (p) => formatDatePt(p.trade.date),
    },
    {
      id: "symbol",
      header: "Símbolo",
      required: true,
      sortValue: (p) => p.trade.symbol,
      cell: (p) => <span className="font-medium">{p.trade.symbol}</span>,
    },
    {
      id: "kind",
      header: "Tipo",
      sortValue: (p) => p.trade.kind,
      cell: (p) => (p.trade.kind === "buy" ? "Compra" : "Venda"),
    },
    {
      id: "qty",
      header: "Qtd.",
      align: "right",
      sortValue: (p) => p.trade.quantity,
      cell: (p) => formatQuantity(p.trade.quantity),
    },
    {
      id: "amount",
      header: "Valor (EUR)",
      align: "right",
      sortValue: (p) => p.trade.amountEur,
      cell: (p) => privateEUR(p.trade.amountEur, hidden),
    },
    {
      id: "fx",
      header: "Câmbio",
      align: "right",
      defaultHidden: true,
      sortValue: (p) => p.trade.fxRate,
      cell: (p) => formatNumber(p.trade.fxRate, 4),
    },
    {
      id: "action",
      header: "Ação",
      required: true,
      sortValue: (p) => p.action,
      cell: (p) => (
        <div>
          <Badge tone={TRADE_LABEL[p.action].tone}>{TRADE_LABEL[p.action].label}</Badge>
          {p.reason && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{p.reason}</p>}
        </div>
      ),
    },
  ];

  const tradeCard = (p: PlannedTrade) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{p.trade.symbol}</p>
          <p className="text-xs text-muted-foreground">
            {formatDatePt(p.trade.date)} · {p.trade.kind === "buy" ? "Compra" : "Venda"} ·{" "}
            {formatQuantity(p.trade.quantity)} un.
          </p>
        </div>
        <p className="num shrink-0 font-semibold">{privateEUR(p.trade.amountEur, hidden)}</p>
      </div>
      <Badge tone={TRADE_LABEL[p.action].tone}>{TRADE_LABEL[p.action].label}</Badge>
      {p.reason && <p className="text-xs text-muted-foreground">{p.reason}</p>}
    </div>
  );

  const dividendColumns: Column<PlannedDividend>[] = [
    {
      id: "date",
      header: "Data",
      required: true,
      sortValue: (p) => p.dividend.date,
      cell: (p) => formatDatePt(p.dividend.date),
    },
    {
      id: "symbol",
      header: "Símbolo",
      required: true,
      cell: (p) => <span className="font-medium">{p.dividend.symbol}</span>,
    },
    {
      id: "gross",
      header: "Bruto",
      align: "right",
      sortValue: (p) => p.dividend.grossEur,
      cell: (p) => privateEUR(p.dividend.grossEur, hidden),
    },
    {
      id: "tax",
      header: "Imposto",
      align: "right",
      sortValue: (p) => p.dividend.taxEur,
      cell: (p) => privateEUR(p.dividend.taxEur, hidden),
    },
    {
      id: "net",
      header: "Líquido",
      align: "right",
      sortValue: (p) => p.dividend.netEur,
      cell: (p) => privateEUR(p.dividend.netEur, hidden),
    },
    {
      id: "action",
      header: "Ação",
      required: true,
      cell: (p) => (
        <Badge tone={DIVIDEND_LABEL[p.action].tone}>{DIVIDEND_LABEL[p.action].label}</Badge>
      ),
    },
  ];

  const dividendCard = (p: PlannedDividend) => (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">{p.dividend.symbol}</p>
        <p className="text-xs text-muted-foreground">{formatDatePt(p.dividend.date)}</p>
        <div className="mt-2">
          <Badge tone={DIVIDEND_LABEL[p.action].tone}>{DIVIDEND_LABEL[p.action].label}</Badge>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="num font-semibold">{privateEUR(p.dividend.grossEur, hidden)}</p>
        <p className="num text-xs text-muted-foreground">
          líquido {privateEUR(p.dividend.netEur, hidden)}
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Importar extrato XTB"
        subtitle="Concilia as tuas compras e vendas com o valor real em euros debitado pelo broker e confirma os dividendos recebidos."
      />

      <Card title="1 · Escolhe os extratos">
        <p className="mb-3 text-sm text-muted-foreground">
          Na XTB, exporta o histórico de cada conta em Excel (ou o CSV das <em>Cash Operations</em>)
          e escolhe os ficheiros todos de uma vez. As contas em dólares são convertidas ao câmbio de
          cada dia. Os ficheiros são lidos no teu browser e nada é gravado antes de confirmares.
        </p>
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void readFiles([...e.dataTransfer.files]);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
            dragging ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40",
          )}
        >
          <FileUp aria-hidden className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm font-medium">
            {files
              ? files.map((f) => f.name).join(", ")
              : "Arrasta os extratos para aqui ou clica para escolher"}
          </span>
          <span className="text-xs text-muted-foreground">Excel ou CSV · máximo 5 MB cada</span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple
            accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              void readFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </label>
        {files && files.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-sm text-muted-foreground">
            {files.map((f) => (
              <li key={f.name}>
                {f.account ? `Conta ${f.account}` : f.name} ({f.currency}) · {f.rows.length}{" "}
                operações
              </li>
            ))}
          </ul>
        )}
        {fileError && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {fileError}
          </p>
        )}
      </Card>

      {preview.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          A analisar o extrato…
        </p>
      )}

      {preview.data && plan && (
        <>
          <Card title="2 · Pré-visualização">
            <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
              <MetricCard label="Movimentos novos" value={String(plan.summary.insert)} />
              <MetricCard
                label="A conciliar"
                value={String(plan.summary.reconcile)}
                sub="movimentos manuais iguais"
              />
              <MetricCard
                label="Dividendos"
                value={String(plan.summary.dividend_insert + plan.summary.dividend_confirm)}
                sub={`${plan.summary.dividend_confirm} confirmam estimativas`}
              />
              <MetricCard
                label="Já importados"
                value={String(plan.summary.duplicate + plan.summary.dividend_duplicate)}
              />
            </div>

            {(plan.summary.unmatched > 0 ||
              plan.summary.blocked > 0 ||
              plan.unmatchedSymbols.length > 0 ||
              preview.data.transfers) && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
              >
                <p className="flex items-center gap-2 font-medium">
                  <TriangleAlert aria-hidden className="h-4 w-4 text-warning" />
                  Atenção
                </p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
                  {plan.unmatchedSymbols.length > 0 && (
                    <li>
                      Sem ativo correspondente na carteira (ficam de fora):{" "}
                      <strong className="text-foreground">
                        {plan.unmatchedSymbols.join(", ")}
                      </strong>
                      . Cria primeiro o ativo e volta a importar.
                    </li>
                  )}
                  {preview.data.transfers && (
                    <li>
                      Houve transferências de títulos entre contas XTB. Os títulos transferidos não
                      aparecem como compra na conta de destino: a compra conta pela data e custo
                      originais (na conta de onde saíram). Confirma que não ficam registados duas
                      vezes.
                    </li>
                  )}
                  {plan.summary.blocked > 0 && (
                    <li>
                      {plan.summary.blocked} movimentos bloqueados porque deixariam o histórico do
                      ativo inválido (ex.: vender mais do que se detém).
                    </li>
                  )}
                </ul>
              </div>
            )}

            {preview.data.errors.length > 0 && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-medium">
                  {preview.data.errors.length} linhas não puderam ser lidas
                </summary>
                <ul className="mt-2 list-inside list-disc text-muted-foreground">
                  {preview.data.errors.slice(0, 20).map((e) => (
                    <li key={`${e.line}-${e.message}`}>
                      Linha {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {preview.data.ignored.length > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                Ignorado por não afetar a carteira:{" "}
                {preview.data.ignored.map((i) => `${i.type} (${i.count})`).join(", ")}.
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button onClick={runCommit} loading={commit.isPending} disabled={toWrite === 0}>
                Importar {toWrite > 0 ? `(${toWrite})` : ""}
              </Button>
              {toWrite === 0 && (
                <p className="text-sm text-muted-foreground">Não há nada novo para importar.</p>
              )}
            </div>
          </Card>

          {plan.trades.length > 0 && (
            <section aria-labelledby="imp-mov" className="space-y-3">
              <h2 id="imp-mov" className="text-base font-semibold">
                Movimentos ({plan.trades.length})
              </h2>
              <DataTable
                rows={plan.trades}
                columns={tradeColumns}
                rowKey={(p) => p.trade.sourceId}
                caption="Movimentos do extrato e ação prevista"
                storageKey="import-trades"
                defaultSort={{ id: "date", dir: "desc" }}
                searchText={(p) => `${p.trade.symbol} ${TRADE_LABEL[p.action].label}`}
                searchPlaceholder="Pesquisar símbolo ou ação…"
                pageSize={25}
                renderCard={tradeCard}
              />
            </section>
          )}

          {plan.dividends.length > 0 && (
            <section aria-labelledby="imp-div" className="space-y-3">
              <h2 id="imp-div" className="text-base font-semibold">
                Dividendos ({plan.dividends.length})
              </h2>
              <DataTable
                rows={plan.dividends}
                columns={dividendColumns}
                rowKey={(p) => p.dividend.sourceId}
                caption="Dividendos do extrato e ação prevista"
                defaultSort={{ id: "date", dir: "desc" }}
                pageSize={25}
                renderCard={dividendCard}
              />
            </section>
          )}

          {plan.trades.length === 0 && plan.dividends.length === 0 && (
            <EmptyState
              title="O ficheiro não tem operações importáveis"
              description="Confirma que exportaste o histórico das contas (compras, vendas e dividendos) da XTB."
            />
          )}
        </>
      )}

      <HistoryRebuildCard />
      <HistoryImportCard />
    </div>
  );
}
