import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { listAssets } from "@/lib/portfolio.functions";
import { getExposure } from "@/lib/exposure.functions";
import { getAllocation } from "@/lib/goals.functions";
import { analyzePurchase, type ConcentrationSnapshot } from "@/lib/decision";
import type { PositionInput } from "@/lib/exposure-types";
import type { DriftReport } from "@/lib/allocation";
import {
  CLASS_LABELS,
  CLASS_ORDER,
  isOpenPosition,
  type AssetClass,
  type Asset,
} from "@/lib/portfolio-types";
import {
  Card,
  ErrorState,
  Field,
  KpiGridSkeleton,
  MetricCard,
  SelectInput,
  TextInput,
} from "@/components/ui-bits";
import { usePrivateMode } from "@/components/private-mode";
import { formatPct, formatPp, parseNumberOr } from "@/lib/format";
import { privateEUR } from "@/components/private-value";

/** Simulador de compra (separador de Objetivos). Não grava nada na carteira. */
export function PurchaseSimulator() {
  const fetch = useServerFn(listAssets);
  const fetchExposure = useServerFn(getExposure);
  const fetchAllocation = useServerFn(getAllocation);
  const { hidden } = usePrivateMode();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetch(),
  });
  const { data: exposure } = useQuery({ queryKey: ["exposure"], queryFn: () => fetchExposure() });
  const { data: allocationData } = useQuery({
    queryKey: ["allocation", "class", 0],
    queryFn: () => fetchAllocation({ data: { scope: "class", contribution: 0 } }),
  });
  const assets = useMemo(() => (data ?? []) as Asset[], [data]);
  const openAssets = useMemo(() => assets.filter(isOpenPosition), [assets]);
  const positions = (exposure as { positions?: PositionInput[] } | undefined)?.positions;
  const targets = useMemo(() => {
    const drift = (allocationData as { drift?: DriftReport } | undefined)?.drift;
    if (!drift || drift.targetSum <= 0) return undefined;
    return drift.rows
      .filter((r) => r.targetPct > 0)
      .map((r) => ({ key: r.key, targetPct: r.targetPct }));
  }, [allocationData]);

  const [amount, setAmount] = useState("250");
  const [cls, setCls] = useState<AssetClass>("etf");
  const [assetId, setAssetId] = useState("");
  const selected = openAssets.find((a) => a.id === assetId);
  // Um ativo existente fixa a classe: não se simula um ETF como se fosse um REIT.
  const assetClass = selected?.class ?? cls;
  const result = useMemo(
    () =>
      analyzePurchase(
        assets,
        {
          amount: parseNumberOr(amount, 0),
          assetClass,
          ...(assetId ? { assetId } : {}),
          name: selected?.name ?? "Novo ativo",
        },
        {
          ...(positions ? { positions } : {}),
          ...(targets ? { targets } : {}),
        },
      ),
    [assets, amount, assetClass, assetId, selected, positions, targets],
  );
  const money = (v: number) => privateEUR(v, hidden);
  const pct = (v: number) => formatPct(v, 1);
  const company = (s: ConcentrationSnapshot) => s.largestCompanyLabel ?? undefined;

  return (
    <div className="space-y-6">
      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="space-y-4 lg:col-span-1">
              <Field label="Ativo existente (opcional)">
                <SelectInput value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                  <option value="">Novo ativo</option>
                  {openAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Classe" hint={selected ? "Definida pelo ativo escolhido." : undefined}>
                <SelectInput
                  value={assetClass}
                  disabled={!!selected}
                  onChange={(e) => setCls(e.target.value as AssetClass)}
                >
                  {CLASS_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {CLASS_LABELS[c]}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Montante da compra (€)">
                <TextInput
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                A simulação não grava nada na carteira.
              </p>
            </Card>
            {isLoading ? (
              <div className="lg:col-span-2">
                <KpiGridSkeleton count={5} />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
                <MetricCard label="Carteira atual" value={money(result.currentTotal)} />
                <MetricCard label="Após compra" value={money(result.proposedTotal)} />
                <MetricCard label="Peso da compra" value={pct(result.purchasePct)} />
                <MetricCard
                  label="Maior empresa (com ETFs)"
                  value={`${pct(result.before.largestCompanyPct)} → ${pct(result.after.largestCompanyPct)}`}
                  {...(company(result.after) ? { sub: company(result.after)! } : {})}
                  className="sm:col-span-2"
                />
                <MetricCard
                  label="5 maiores empresas"
                  value={`${pct(result.before.top5CompaniesPct)} → ${pct(result.after.top5CompaniesPct)}`}
                />
              </div>
            )}
          </div>

          {!isLoading && !result.lookThrough && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Sem a composição dos ETFs, cada posição conta como uma empresa. Atualiza a
                composição na página{" "}
                <Link to="/exposicao" className="underline">
                  Risco e exposição
                </Link>{" "}
                para veres a concentração real.
              </span>
            </p>
          )}

          <Card
            title="Alocação: atual vs. após compra"
            description={
              result.hasTargets
                ? "Comparada com os teus alvos de alocação."
                : "Sem alvos definidos: define-os no separador Alocação para veres o desvio de cada classe."
            }
          >
            <div className="space-y-3">
              {result.allocation.map((x) => (
                <div
                  key={x.class}
                  className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[1fr_auto_auto_auto]"
                >
                  <span>{x.label}</span>
                  <span className="num">
                    {pct(x.currentPct)} → {pct(x.proposedPct)}
                  </span>
                  <span
                    className={x.deltaPct > 0 ? "num text-primary" : "num text-muted-foreground"}
                  >
                    {formatPp(x.deltaPct, 1)}
                  </span>
                  {x.targetPct != null && (
                    <span className="num col-span-3 text-xs text-muted-foreground sm:col-span-1 sm:text-right sm:text-sm">
                      alvo {formatPct(x.targetPct, 0)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {result.alerts.length > 0 && (
            <Card
              title="Alertas"
              icon={<TriangleAlert aria-hidden className="h-4 w-4 text-destructive" />}
              className="border-destructive/30 bg-destructive/5"
            >
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {result.alerts.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Card>
          )}
          {result.notes.length > 0 && (
            <Card
              title="A favor"
              icon={<CircleCheck aria-hidden className="h-4 w-4 text-success" />}
              className="border-success/30 bg-success/5"
            >
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
