import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Calculator, ClipboardList, Gauge, Scale } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  KpiGridSkeleton,
  MetricCard,
  TextInput,
} from "@/components/ui-bits";
import { InfoTip } from "@/components/info-tip";
import { CLASS_COLOR } from "@/components/chart-kit";
import { usePrivateMode } from "@/components/private-mode";
import { privateEUR } from "@/components/private-value";
import { listAssets, listDividends, listTransactions } from "@/lib/portfolio.functions";
import { listPortfolioSnapshots } from "@/lib/snapshots.functions";
import {
  RISK_FREE_DEFAULT_PCT,
  getInvestorProfile,
  saveInvestorProfile,
  type InvestorProfile,
} from "@/lib/risk-profile.functions";
import {
  MAX_SCORE,
  MIN_MONTHS,
  RISK_PROFILES,
  RISK_QUESTIONS,
  SHORT_SAMPLE_MONTHS,
  annualizedStats,
  aversionFromScore,
  describeRiskModel,
  parseRiskInputs,
  profileForAversion,
  riskModel,
  riskWeights,
  riskyMonthlyReturns,
  scoreAnswers,
  sensitivityByAversion,
  validateRiskInputs,
  type RiskAnswers,
  type RiskInputsForm,
  type RiskQuestionId,
} from "@/lib/risk-profile";
import type { PerfTransaction } from "@/lib/performance";
import type { DividendRecord } from "@/lib/dividends";
import type { Asset } from "@/lib/portfolio-types";
import { formatMonthPt, formatNumber, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Draft extends RiskInputsForm {
  answers: RiskAnswers;
}

const pctText = (n: string) => n.replace(".", ",");

function draftFrom(profile: InvestorProfile | null | undefined): Draft {
  return {
    answers: profile?.answers ?? {},
    riskFree: pctText(String(profile?.riskFreePct ?? RISK_FREE_DEFAULT_PCT)),
    outsideCash: profile?.outsideCash
      ? formatNumber(profile.outsideCash, 0).replace(/\s/g, "")
      : "",
    expectedReturn:
      profile?.expectedReturnPct == null ? "" : pctText(String(profile.expectedReturnPct)),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  const answers = (d: Draft) =>
    JSON.stringify(RISK_QUESTIONS.map((q) => d.answers[q.id as RiskQuestionId] ?? null));
  return (
    answers(a) === answers(b) &&
    a.riskFree.trim() === b.riskFree.trim() &&
    a.outsideCash.trim() === b.outsideCash.trim() &&
    a.expectedReturn.trim() === b.expectedReturn.trim()
  );
}

/** Fração (0,42) em percentagem sem casas ("42 %"). */
const share = (y: number | null) => (y == null ? "—" : formatPct(y * 100, 0));
/** Taxa anual (0,083) em percentagem com uma casa ("8,3 %"). */
const rate = (r: number | null) => (r == null ? "—" : formatPct(r * 100, 1));

/** Separador «Perfil de risco» de Objetivos: questionário, A e utilidade média-variância. */
export function RiskProfilePanel() {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getInvestorProfile);
  const saveFn = useServerFn(saveInvestorProfile);

  const profileQ = useQuery({ queryKey: ["investor-profile"], queryFn: () => fetchProfile() });
  const assetsQ = useQuery({ queryKey: ["assets"], queryFn: () => listAssets() });
  const txQ = useQuery({ queryKey: ["transactions"], queryFn: () => listTransactions({}) });
  const divQ = useQuery({ queryKey: ["dividends"], queryFn: () => listDividends() });
  const snapQ = useQuery({
    queryKey: ["portfolio-snapshots"],
    queryFn: () => listPortfolioSnapshots(),
  });

  const assets = useMemo(() => (assetsQ.data ?? []) as Asset[], [assetsQ.data]);
  const transactions = useMemo(() => (txQ.data ?? []) as PerfTransaction[], [txQ.data]);
  const dividends = useMemo(() => (divQ.data ?? []) as DividendRecord[], [divQ.data]);
  const snapshots = useMemo(() => snapQ.data ?? [], [snapQ.data]);

  const saved = useMemo(() => draftFrom(profileQ.data), [profileQ.data]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = draft ?? saved;
  const dirty = draft != null && !sameDraft(draft, saved);
  const [saving, setSaving] = useState(false);

  const savedComplete = scoreAnswers(saved.answers).complete;
  const [questionsOpen, setQuestionsOpen] = useState<boolean | null>(null);
  const showQuestions = questionsOpen ?? !savedComplete;

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...(d ?? saved), ...patch }));
  const answer = (id: RiskQuestionId, index: number) =>
    update({ answers: { ...current.answers, [id]: index } });

  const errors = validateRiskInputs(current);
  const inputs = parseRiskInputs(current, RISK_FREE_DEFAULT_PCT);

  const score = scoreAnswers(current.answers);
  const a = score.complete ? aversionFromScore(score.score) : null;
  const profile = a == null ? null : RISK_PROFILES[profileForAversion(a)];

  const stats = useMemo(
    () => annualizedStats(riskyMonthlyReturns(assets, transactions, dividends, snapshots)),
    [assets, transactions, dividends, snapshots],
  );
  const manualExpected = inputs.expectedReturnPct != null;
  const expected = manualExpected ? inputs.expectedReturnPct! / 100 : stats.expectedReturn;
  const riskFree = inputs.riskFreePct / 100;
  const weights = useMemo(
    () => riskWeights(assets, inputs.outsideCash),
    [assets, inputs.outsideCash],
  );
  const modelInput = {
    a: a ?? 0,
    expected,
    volatility: stats.volatility,
    riskFree,
    riskyShare: weights.riskyShare,
  };
  const model = a == null ? null : riskModel(modelInput);
  const reading = model ? describeRiskModel({ ...modelInput, months: stats.months }, model) : [];
  const table = sensitivityByAversion(expected, stats.volatility, riskFree);

  const save = async () => {
    if (Object.keys(errors).length > 0) {
      toast.error("Corrige os pressupostos assinalados antes de guardar.");
      return;
    }
    setSaving(true);
    try {
      await saveFn({ data: { answers: current.answers, ...inputs } });
      await queryClient.invalidateQueries({ queryKey: ["investor-profile"] });
      setDraft(null);
      if (score.complete) setQuestionsOpen(false);
      toast.success("Perfil de risco guardado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível guardar o perfil.");
    } finally {
      setSaving(false);
    }
  };

  const dataLoading = assetsQ.isLoading || txQ.isLoading || divQ.isLoading || snapQ.isLoading;
  const dataError = assetsQ.isError || txQ.isError || divQ.isError || snapQ.isError;

  if (profileQ.isLoading) return <KpiGridSkeleton />;
  if (profileQ.isError) return <ErrorState onRetry={() => void profileQ.refetch()} />;

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- */}
      {/* Resultado do questionário                                    */}
      {/* ---------------------------------------------------------- */}
      <Card
        title="Perfil de investidor"
        icon={<Gauge aria-hidden className="h-4 w-4 text-primary" />}
        action={
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showQuestions}
            aria-controls="risk-questions"
            onClick={() => setQuestionsOpen(!showQuestions)}
          >
            {showQuestions ? "Esconder perguntas" : "Rever respostas"}
          </Button>
        }
      >
        {a != null && profile ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <p className="text-[12.5px] font-medium text-muted-foreground">
                Aversão ao risco{" "}
                <InfoTip label="O que é o coeficiente A?">
                  O coeficiente de aversão ao risco (A) mede quanto retorno exiges para aceitar
                  oscilações. Vai de 1 (toleras muito risco) a 10 (quase nenhum).
                </InfoTip>
              </p>
              <p className="num mt-1 text-3xl font-bold">A = {a}</p>
            </div>
            <div className="min-w-0 flex-1">
              <Badge tone="primary">{profile.label}</Badge>
              <p className="mt-1.5 text-sm text-muted-foreground">{profile.description}</p>
              <p className="num mt-1 text-xs text-muted-foreground">
                Pontuação {score.score} de {MAX_SCORE}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Responde às {score.total} perguntas para calcular o teu coeficiente de aversão ao risco
            (A).
          </p>
        )}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Respostas</span>
            <span className="num">
              {score.answered} de {score.total}
            </span>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label="Perguntas respondidas"
            aria-valuemin={0}
            aria-valuemax={score.total}
            aria-valuenow={score.answered}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${(score.answered / score.total) * 100}%` }}
            />
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------------- */}
      {/* Questionário                                                 */}
      {/* ---------------------------------------------------------- */}
      {showQuestions && (
        <Card
          title="Questionário"
          icon={<ClipboardList aria-hidden className="h-4 w-4 text-primary" />}
          description="Escolhe a opção que melhor te descreve. Em cada pergunta, as opções vão da mais prudente (0 pontos) à mais tolerante ao risco (3 pontos)."
        >
          <div id="risk-questions" className="grid gap-5 lg:grid-cols-2">
            {RISK_QUESTIONS.map((q, qi) => (
              <fieldset key={q.id} className="min-w-0">
                <legend className="mb-2 text-sm font-medium">
                  <span className="num text-muted-foreground">{qi + 1}.</span> {q.question}
                </legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {q.options.map((label, oi) => {
                    const checked = current.answers[q.id] === oi;
                    return (
                      <label
                        key={label}
                        className={cn(
                          "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-colors",
                          checked
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <input
                          type="radio"
                          name={`risk-${q.id}`}
                          value={oi}
                          checked={checked}
                          onChange={() => answer(q.id, oi)}
                          className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- */}
      {/* Carteira face ao modelo                                      */}
      {/* ---------------------------------------------------------- */}
      <Card
        title="Carteira face ao modelo"
        icon={<Scale aria-hidden className="h-4 w-4 text-primary" />}
        description="Retorno e volatilidade da parte de risco (ETFs, ações e REITs), a partir das rentabilidades mensais das fotografias diárias."
      >
        {dataLoading ? (
          <KpiGridSkeleton />
        ) : dataError ? (
          <ErrorState
            onRetry={() => {
              void assetsQ.refetch();
              void txQ.refetch();
              void divQ.refetch();
              void snapQ.refetch();
            }}
          />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
              <MetricCard
                label={
                  <>
                    Retorno esperado E(r){" "}
                    <InfoTip label="Como se calcula o retorno esperado?">
                      Média das rentabilidades mensais (TWR, sem o efeito dos aportes) vezes 12. Se
                      indicares um valor nos pressupostos, é esse que conta.
                    </InfoTip>
                  </>
                }
                value={rate(expected)}
                sub={
                  manualExpected
                    ? "Definido por ti"
                    : stats.unavailable
                      ? "Sem histórico suficiente"
                      : `Histórico, ${stats.months} meses`
                }
              />
              <MetricCard
                label={
                  <>
                    Volatilidade σ{" "}
                    <InfoTip label="O que é a volatilidade?">
                      Desvio-padrão das rentabilidades mensais vezes √12: quanto o resultado anual
                      costuma afastar-se da média.
                    </InfoTip>
                  </>
                }
                value={rate(stats.volatility)}
                sub={stats.unavailable ? "Sem histórico suficiente" : "Anualizada"}
              />
              <MetricCard
                label={
                  <>
                    Utilidade U{" "}
                    <InfoTip label="O que é a utilidade?">
                      U = E(r) − ½·A·σ². É o retorno sem risco que te deixaria tão satisfeito como a
                      parte de risco, dado o teu A.
                    </InfoTip>
                  </>
                }
                value={rate(model?.utility ?? null)}
                sub={a == null ? "Falta o questionário" : `Com A = ${a}`}
              />
              <MetricCard
                label={
                  <>
                    Fração ótima y*{" "}
                    <InfoTip label="O que é a fração ótima?">
                      y* = (E(r) − rf) / (A·σ²): a parte da carteira em ativos de risco que maximiza
                      a utilidade. O resto ficaria num ativo sem risco.
                    </InfoTip>
                  </>
                }
                value={share(model?.yStar ?? null)}
                sub={
                  a == null
                    ? "Falta o questionário"
                    : model?.yStar != null && model.yStar > 1
                      ? `Acima de ${formatPct(100, 0)}: exigiria alavancagem`
                      : "Em ativos de risco"
                }
              />
            </div>

            {stats.unavailable && !manualExpected && (
              <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
                {stats.unavailable} As estatísticas aparecem quando houver pelo menos {MIN_MONTHS}{" "}
                meses completos de fotografias.
              </p>
            )}
            {!stats.unavailable && stats.months < SHORT_SAMPLE_MONTHS && (
              <p className="text-xs text-muted-foreground">
                Amostra curta ({stats.months} meses, até {formatMonthPt(stats.to)}): a média de
                poucos anos pode estar muito longe do retorno dos próximos.
              </p>
            )}

            <RiskShareBars current={weights.riskyShare} target={model?.yTarget ?? null} a={a} />

            {reading.length > 0 && (
              <div className="space-y-2 rounded-lg bg-secondary/60 p-3 text-sm leading-relaxed">
                {reading.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                Peso de cada classe
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {weights.byClass.map((c) => (
                  <li key={c.class} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: CLASS_COLOR[c.class] }}
                      />
                      <span className="truncate">{c.label}</span>
                      <Badge tone={c.risky ? "warn" : "neutral"}>
                        {c.risky ? "Risco" : "Defensivo"}
                      </Badge>
                    </span>
                    <span className="num shrink-0 text-right">
                      {privateEUR(c.value, hidden)}{" "}
                      <span className="text-muted-foreground">
                        · {share(weights.total > 0 ? c.value / weights.total : null)}
                      </span>
                    </span>
                  </li>
                ))}
                {weights.outsideCash > 0 && (
                  <li className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-border" />
                      <span className="truncate">Liquidez fora da carteira</span>
                      <Badge tone="neutral">Defensivo</Badge>
                    </span>
                    <span className="num shrink-0 text-right">
                      {privateEUR(weights.outsideCash, hidden)}{" "}
                      <span className="text-muted-foreground">
                        · {share(weights.outsideCash / weights.total)}
                      </span>
                    </span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------------- */}
      {/* Pressupostos                                                 */}
      {/* ---------------------------------------------------------- */}
      <Card
        title="Pressupostos"
        description="Ficam guardados com as respostas. A liquidez conta como parte defensiva."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Taxa sem risco (% ao ano)"
            required
            error={errors.riskFree}
            hint="Ex.: depósitos a prazo ou Certificados de Aforro."
          >
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              value={current.riskFree}
              onChange={(e) => update({ riskFree: e.target.value })}
            />
          </Field>
          <Field
            label="Liquidez fora da carteira (€)"
            error={errors.outsideCash}
            hint="Depósitos e poupança que não estão na app (opcional)."
          >
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={current.outsideCash}
              onChange={(e) => update({ outsideCash: e.target.value })}
            />
          </Field>
          <Field
            label="Retorno esperado da parte de risco (%)"
            error={errors.expectedReturn}
            hint="Vazio = usar o histórico das fotografias."
          >
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              placeholder={stats.expectedReturn == null ? "" : rate(stats.expectedReturn)}
              value={current.expectedReturn}
              onChange={(e) => update({ expectedReturn: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      {/* ---------------------------------------------------------- */}
      {/* Como se calcula + tabela de conversão                        */}
      {/* ---------------------------------------------------------- */}
      <Card
        title="Como se calcula"
        icon={<Calculator aria-hidden className="h-4 w-4 text-primary" />}
      >
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            Cada resposta vale de 0 a 3 pontos (máximo {MAX_SCORE}). A pontuação converte-se no
            coeficiente A pela tabela abaixo: quanto mais pontos, mais tolerância ao risco e menor o
            A.
          </p>
          <p>
            Com A, o modelo média-variância de Markowitz calcula a utilidade{" "}
            <span className="num whitespace-nowrap text-foreground">U = E(r) − ½·A·σ²</span> e a
            fração ótima em ativos de risco{" "}
            <span className="num whitespace-nowrap text-foreground">y* = (E(r) − rf) / (A·σ²)</span>
            . E(r) e σ vêm das rentabilidades mensais da parte de risco (média × 12 e desvio-padrão
            × √12); rf é a taxa sem risco dos pressupostos.
          </p>
        </div>
        <div className="-mx-4 mt-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <table className="w-full min-w-[20rem] text-sm">
            <caption className="sr-only">Conversão da pontuação no coeficiente A</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Pontuação
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  A
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Perfil
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  y* com os teus dados
                </th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => {
                const mine = row.a === a;
                return (
                  <tr
                    key={row.a}
                    aria-current={mine ? "true" : undefined}
                    className={cn(
                      "border-b border-border last:border-0",
                      mine && "bg-primary/10 font-medium",
                    )}
                  >
                    <td className="num py-2 pr-3">
                      {row.minScore}–{row.maxScore}
                    </td>
                    <td className="num py-2 pr-3">{row.a}</td>
                    <td className="py-2 pr-3">{RISK_PROFILES[row.profile].label}</td>
                    <td className="num py-2 text-right">{share(row.yStar)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {dirty && (
        <div
          role="region"
          aria-label="Alterações por guardar"
          className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur"
        >
          <p className="text-sm text-muted-foreground">
            {score.complete
              ? "Tens alterações por guardar."
              : `Faltam ${score.total - score.answered} respostas; podes guardar e continuar depois.`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>
              Descartar
            </Button>
            <Button size="sm" onClick={() => void save()} loading={saving}>
              Guardar perfil
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Duas barras: peso atual em ativos de risco e o que o modelo indica (y* entre 0 e 100 %). */
function RiskShareBars({
  current,
  target,
  a,
}: {
  current: number | null;
  target: number | null;
  a: number | null;
}) {
  const rows = [
    { label: "Hoje em ações, ETFs e REITs", value: current, tone: "bg-primary" },
    {
      label: a == null ? "Modelo (falta o questionário)" : `Modelo para A = ${a}`,
      value: target,
      tone: "bg-foreground/60",
    },
  ];
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="num font-medium">{share(r.value)}</span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn("h-full rounded-full transition-[width]", r.tone)}
              style={{ width: `${Math.min(100, Math.max(0, (r.value ?? 0) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
