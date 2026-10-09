import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState } from "react";
import { FileUp, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  KpiGridSkeleton,
  MetricCard,
  PageHeader,
  useConfirm,
} from "@/components/ui-bits";
import { DataTable, type Column } from "@/components/data-table";
import { usePrivateMode } from "@/components/private-mode";
import { commitScrambleImport, getScramble, previewScrambleImport } from "@/lib/scramble.functions";
import {
  SCRAMBLE_CASH_LABELS,
  type RoundStatus,
  type ScrambleCashRow,
  type ScrambleImportPlan,
  type ScrambleRound,
} from "@/lib/scramble";
import { formatDatePt, formatEUR, formatPct, formatSignedEUR } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX_BYTES = 2_000_000;

const STATUS: Record<RoundStatus, { label: string; tone: "info" | "neutral" | "loss" }> = {
  active: { label: "Ativa", tone: "info" },
  matured: { label: "Vencida", tone: "neutral" },
  late: { label: "Em atraso", tone: "loss" },
};

const monthFormatter = new Intl.DateTimeFormat("pt-PT", { month: "long", timeZone: "UTC" });

/** "2026-05" → "Maio 2026". */
function roundLabel(key: string): string {
  const month = monthFormatter.format(new Date(`${key}-01T00:00:00Z`));
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${key.slice(0, 4)}`;
}

interface PendingFile {
  name: string;
  csv: string;
  plan: ScrambleImportPlan | null;
  errors: string[];
}

/** Os ficheiros do portefólio entram primeiro: definem as rondas. */
const IMPORT_ORDER = { portfolio: 0, cash: 1 } as const;

export function ScramblePanel() {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const fetchScramble = useServerFn(getScramble);
  const previewFn = useServerFn(previewScrambleImport);
  const commitFn = useServerFn(commitScrambleImport);
  const inputId = useId();

  const [showImport, setShowImport] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [reading, setReading] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["scramble"],
    queryFn: () => fetchScramble(),
  });

  const readFiles = async (list: FileList | File[]) => {
    setReading(true);
    try {
      const out: PendingFile[] = [];
      for (const file of Array.from(list)) {
        if (file.size > MAX_BYTES) {
          out.push({
            name: file.name,
            csv: "",
            plan: null,
            errors: ["Ficheiro demasiado grande."],
          });
          continue;
        }
        const csv = await file.text();
        const res = await previewFn({ data: { csv } });
        out.push({ name: file.name, csv, plan: res.plan, errors: res.errors });
      }
      setFiles(out);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o ficheiro.");
    } finally {
      setReading(false);
    }
  };

  const ready = files.filter((f) => f.plan);

  const commit = useMutation({
    mutationFn: async () => {
      const ordered = [...ready].sort(
        (a, b) => IMPORT_ORDER[a.plan!.kind] - IMPORT_ORDER[b.plan!.kind],
      );
      for (const f of ordered) await commitFn({ data: { csv: f.csv } });
    },
    onSuccess: async () => {
      await Promise.all(
        ["scramble", "assets", "data-quality", "fire", "portfolio-snapshots", "allocation"].map(
          (k) => queryClient.invalidateQueries({ queryKey: [k] }),
        ),
      );
      toast.success("Scramble atualizada.");
      setFiles([]);
      setShowImport(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runCommit = async () => {
    const replaced = ready.reduce((s, f) => s + (f.plan?.replaced ?? 0), 0);
    const ok = await confirm({
      title: `Importar ${ready.length === 1 ? "este relatório" : `${ready.length} relatórios`}?`,
      description:
        replaced > 0
          ? `Os ${replaced} movimentos já guardados nos mesmos períodos vão ser substituídos pelos do ficheiro. Repetir a importação nunca cria duplicados.`
          : "Os movimentos ficam guardados e o valor da conta Scramble é atualizado. Repetir a importação nunca cria duplicados.",
      confirmLabel: "Importar",
    });
    if (ok) commit.mutate();
  };

  const s = data?.summary;
  const hasData = !!data && (data.counts.cash > 0 || data.counts.rounds > 0);
  const needsCash = !!data && data.counts.cash === 0 && data.counts.rounds > 0;
  const needsRounds = !!data && data.counts.rounds === 0 && data.counts.cash > 0;

  const importCard = (
    <Card
      title="Importar relatórios da Scramble"
      action={
        hasData ? (
          <Button variant="ghost" size="sm" onClick={() => setShowImport(false)}>
            Fechar
          </Button>
        ) : undefined
      }
    >
      <ol className="mb-3 list-inside list-decimal space-y-1 text-sm text-muted-foreground">
        <li>
          Na Scramble abre <em>Relatórios</em> e escolhe o período (por exemplo, desde o início do
          ano).
        </li>
        <li>
          Em <em>Movimentos de portfólio</em> e em <em>Movimentos de caixa</em>, carrega em{" "}
          <em>⋮ → Exportar</em> e escolhe o formato <strong>CSV</strong>.
        </li>
        <li>Larga aqui os dois ficheiros. Nada é gravado antes de confirmares.</li>
      </ol>
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
          if (e.dataTransfer.files.length > 0) void readFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
          dragging ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40",
        )}
      >
        <FileUp aria-hidden className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm font-medium">
          {reading ? "A ler…" : "Arrasta os CSV para aqui ou clica para escolher"}
        </span>
        <span className="text-xs text-muted-foreground">Podes escolher os dois de uma vez</span>
        <input
          id={inputId}
          type="file"
          multiple
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void readFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {files.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {files.map((f) => (
            <li key={f.name} className="space-y-1 px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{f.name}</span>
                {f.plan ? (
                  <Badge tone="info">
                    {f.plan.kind === "cash" ? "Movimentos de caixa" : "Movimentos de portfólio"}
                  </Badge>
                ) : (
                  <Badge tone="loss">Não reconhecido</Badge>
                )}
              </div>
              {f.plan ? (
                <p className="text-xs text-muted-foreground">
                  {formatDatePt(f.plan.period.from)} – {formatDatePt(f.plan.period.to)} ·{" "}
                  {f.plan.rows} movimentos
                  {f.plan.kind === "cash"
                    ? ` · depósitos ${formatEUR(f.plan.summary.deposits, hidden)} · juros ${formatEUR(f.plan.summary.interest, hidden)} · bónus ${formatEUR(f.plan.summary.bonus, hidden)}`
                    : ` · ${f.plan.summary.rounds.length} rondas · investido ${formatEUR(f.plan.summary.invested, hidden)}`}
                  {f.plan.replaced > 0 && ` · substitui ${f.plan.replaced} já guardados`}
                </p>
              ) : (
                <p role="alert" className="text-xs text-destructive">
                  {f.errors[0] ?? "Ficheiro inválido."}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {ready.length > 0 && (
        <div className="mt-4 flex justify-end">
          <Button onClick={() => void runCommit()} loading={commit.isPending}>
            Importar {ready.length === 1 ? "relatório" : `${ready.length} relatórios`}
          </Button>
        </div>
      )}
    </Card>
  );

  const roundColumns: Column<ScrambleRound>[] = [
    {
      id: "round",
      header: "Ronda",
      required: true,
      sortValue: (r) => r.roundKey,
      cell: (r) => (
        <div>
          <p className="font-medium">{roundLabel(r.roundKey)}</p>
          <p className="text-xs text-muted-foreground">Grupo {r.group}</p>
        </div>
      ),
    },
    {
      id: "status",
      header: "Estado",
      sortValue: (r) => r.status,
      cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>,
    },
    {
      id: "progress",
      header: "Pagamentos",
      sortValue: (r) => r.paymentsMade,
      cell: (r) => <RoundProgress round={r} />,
    },
    {
      id: "invested",
      header: "Investido",
      align: "right",
      sortValue: (r) => r.invested,
      cell: (r) => formatEUR(r.invested, hidden),
    },
    {
      id: "outstanding",
      header: "Em dívida",
      align: "right",
      sortValue: (r) => r.outstanding,
      cell: (r) => formatEUR(r.outstanding, hidden),
    },
    {
      id: "interest",
      header: "Juros",
      align: "right",
      sortValue: (r) => r.interestExpected,
      cell: (r) =>
        r.status === "matured" ? (
          formatEUR(r.interestReceived, hidden)
        ) : (
          <span>
            <span className="text-muted-foreground">≈ </span>
            {formatEUR(r.interestExpected, hidden)}
            <span className="block text-xs text-muted-foreground">
              corridos {formatEUR(r.interestAccrued, hidden)}
            </span>
          </span>
        ),
    },
    {
      id: "maturity",
      header: "Vencimento",
      align: "right",
      sortValue: (r) => r.maturityDate,
      cell: (r) => formatDatePt(r.maturityDate),
    },
  ];

  const roundCard = (r: ScrambleRound) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{roundLabel(r.roundKey)}</p>
          <p className="text-xs text-muted-foreground">
            Grupo {r.group} · vence a {formatDatePt(r.maturityDate)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num font-semibold">{formatEUR(r.outstanding, hidden)}</p>
          <p className="num text-xs text-muted-foreground">de {formatEUR(r.invested, hidden)}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <RoundProgress round={r} />
        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
      </div>
    </div>
  );

  const cashColumns: Column<ScrambleCashRow>[] = [
    {
      id: "date",
      header: "Data",
      required: true,
      sortValue: (r) => `${r.date}-${String(r.seq).padStart(6, "0")}`,
      cell: (r) => formatDatePt(r.date),
    },
    {
      id: "type",
      header: "Tipo",
      required: true,
      sortValue: (r) => r.type,
      cell: (r) => SCRAMBLE_CASH_LABELS[r.type],
    },
    {
      id: "amount",
      header: "Montante",
      align: "right",
      sortValue: (r) => r.amount,
      cell: (r) => (
        <span className={r.amount > 0 ? "text-success" : undefined}>
          {formatSignedEUR(r.amount, hidden)}
        </span>
      ),
    },
    {
      id: "balance",
      header: "Saldo",
      align: "right",
      defaultHidden: true,
      sortValue: (r) => r.balance ?? 0,
      cell: (r) => (r.balance == null ? "—" : formatEUR(r.balance, hidden)),
    },
  ];

  const cashCard = (r: ScrambleCashRow) => (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">{SCRAMBLE_CASH_LABELS[r.type]}</p>
        <p className="text-xs text-muted-foreground">{formatDatePt(r.date)}</p>
      </div>
      <p className={cn("num shrink-0 font-semibold", r.amount > 0 && "text-success")}>
        {formatSignedEUR(r.amount, hidden)}
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="P2P · Scramble"
        subtitle="Rondas mensais de 6 meses a marcas europeias de bens de consumo. O capital volta todos os meses e os juros no vencimento."
        actions={
          hasData && !showImport ? (
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <FileUp aria-hidden className="h-4 w-4" />
              Importar relatórios
            </Button>
          ) : undefined
        }
      />

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <KpiGridSkeleton count={4} />
      ) : !hasData || !s ? (
        <>
          <EmptyState
            title="Ainda não importaste a Scramble"
            description="Exporta da Scramble os relatórios de movimentos e importa-os aqui: a app mostra as tuas rondas, o calendário de reembolsos, os juros a receber e o que declarar no IRS."
          />
          {importCard}
        </>
      ) : (
        <>
          {showImport && importCard}

          {(needsCash || needsRounds) && (
            <p
              role="status"
              className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
            >
              {needsCash
                ? "Falta o relatório Movimentos de caixa: sem ele não há depósitos, bónus nem saldo de caixa."
                : "Falta o relatório Movimentos de portfólio: sem ele não há rondas nem calendário."}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
            <MetricCard
              label="Saldo total"
              value={formatEUR(s.totalValue, hidden)}
              sub={`em dívida ${formatEUR(s.outstanding, hidden)} · caixa ${formatEUR(s.cash, hidden)}`}
            />
            <MetricCard
              label="Ganho"
              value={formatSignedEUR(s.gain, hidden)}
              sub={`juros ${formatEUR(s.interestReceived, hidden)} · bónus ${formatEUR(s.bonusReceived, hidden)}`}
              tone={s.gain > 0 ? "positive" : s.gain < 0 ? "negative" : "default"}
            />
            <MetricCard
              label="Juros por receber"
              value={formatEUR(s.interestAccrued, hidden)}
              sub={`estimativa · ${formatPct(s.monthlyRate * 100, 2)}/mês${
                s.monthlyRateSource === "history" ? " (efetiva)" : " (taxa base)"
              }`}
            />
            <MetricCard
              label="Rendibilidade anual"
              value={s.xirrPct == null ? "—" : formatPct(s.xirrPct, 1)}
              sub={
                s.xirrPct == null
                  ? "precisa de 3 meses de histórico"
                  : `XIRR com bónus · só juros ≈ ${formatPct(s.monthlyRate * 1200, 1)}`
              }
            />
          </div>

          <div className="grid gap-4 md:gap-5 lg:grid-cols-[5fr_7fr]">
            <Card
              title="Próximos pagamentos"
              description="Estimativa: capital todos os meses, juros no vencimento."
            >
              {s.upcoming.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">Sem pagamentos previstos.</p>
              ) : (
                <ul>
                  {s.upcoming.slice(0, 6).map((u) => (
                    <li
                      key={u.date}
                      className="flex min-h-11 items-center gap-3 border-b border-foreground/5 py-2 last:border-b-0"
                    >
                      <span className="num w-20 shrink-0 text-[13px] font-medium">
                        {formatDatePt(u.date)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {u.rounds.length} {u.rounds.length === 1 ? "ronda" : "rondas"}
                        {u.interest > 0 && " · inclui juros de vencimento"}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="num block text-[13.5px] font-medium">
                          {formatEUR(u.principal + u.interest, hidden)}
                        </span>
                        {u.interest > 0 && (
                          <span className="num block text-xs text-success">
                            +{formatEUR(u.interest, hidden)} juros
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Rendimento por ano"
              description="Para o IRS: os juros vão para o Anexo J (quadro 8A, código E21)."
            >
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Depositado" value={formatEUR(s.netDeposits, hidden)} />
                <Stat label="Investido em rondas" value={formatEUR(s.investedTotal, hidden)} />
                <Stat label="Rondas ativas" value={String(s.activeRounds)} />
                <Stat
                  label="Último movimento"
                  value={s.lastMovement ? formatDatePt(s.lastMovement) : "—"}
                />
              </dl>
              {s.interestByYear.length > 0 && (
                <table className="mt-5 w-full text-sm">
                  <caption className="sr-only">Juros e bónus por ano</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="pb-1 font-medium">Ano</th>
                      <th className="pb-1 text-right font-medium">Juros</th>
                      <th className="pb-1 text-right font-medium">Bónus</th>
                      <th className="pb-1 text-right font-medium">Imposto (28 %)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.interestByYear.map((y) => (
                      <tr key={y.year} className="border-t border-border">
                        <td className="py-1.5">{y.year}</td>
                        <td className="num py-1.5 text-right">{formatEUR(y.interest, hidden)}</td>
                        <td className="num py-1.5 text-right">{formatEUR(y.bonus, hidden)}</td>
                        <td className="num py-1.5 text-right">
                          {formatEUR(y.interest * 0.28, hidden)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <section aria-labelledby="scramble-rounds" className="space-y-3">
            <h2 id="scramble-rounds" className="text-base font-semibold">
              Rondas ({s.rounds.length})
            </h2>
            <DataTable
              rows={s.rounds}
              columns={roundColumns}
              rowKey={(r) => r.roundKey}
              caption="Rondas da Scramble"
              storageKey="scramble-rounds"
              defaultSort={{ id: "round", dir: "desc" }}
              renderCard={roundCard}
            />
          </section>

          {data.cash.length > 0 && (
            <section aria-labelledby="scramble-cash" className="space-y-3">
              <h2 id="scramble-cash" className="text-base font-semibold">
                Movimentos de caixa
              </h2>
              <DataTable
                rows={data.cash}
                columns={cashColumns}
                rowKey={(r) => `${r.date}-${r.seq}`}
                caption="Movimentos de caixa da Scramble"
                storageKey="scramble-cash"
                defaultSort={{ id: "date", dir: "desc" }}
                searchText={(r) => `${SCRAMBLE_CASH_LABELS[r.type]} ${r.label}`}
                pageSize={15}
                renderCard={cashCard}
              />
            </section>
          )}

          <div className="flex gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p>
              A Scramble não é supervisionada por nenhum regulador financeiro e não tem fundo de
              garantia. O dinheiro fica preso até ao vencimento de cada ronda. Os juros por receber
              e o calendário são estimativas feitas com a taxa efetiva das rondas já vencidas.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="num mt-0.5 text-[15px] font-medium">{value}</dd>
    </div>
  );
}

/** Seis marcas, uma por mês: cheias as pagas. */
function RoundProgress({ round }: { round: ScrambleRound }) {
  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`${round.paymentsMade} de 6 pagamentos recebidos`}
    >
      {round.schedule.map((p) => (
        <span
          key={p.month}
          title={`${formatDatePt(p.date)} · ${p.paid ? "recebido" : "previsto"}`}
          className={cn(
            "h-2 w-4 rounded-full",
            p.paid ? "bg-primary" : "bg-foreground/10",
            !p.paid && round.status === "late" && "bg-destructive/40",
          )}
        />
      ))}
    </div>
  );
}
