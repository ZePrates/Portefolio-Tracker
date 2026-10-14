import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { listAssets } from "@/lib/portfolio.functions";
import { analyzePurchase } from "@/lib/decision";
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
  PageHeader,
  SelectInput,
  TextInput,
} from "@/components/ui-bits";
import { usePrivateMode } from "@/components/private-mode";
import { formatEUR, formatNumber, formatPct, formatPp, parseNumberOr } from "@/lib/format";

const DESCRIPTION = "Testa uma compra antes de alterar a carteira.";

export const Route = createFileRoute("/_authenticated/simulador")({
  head: () => ({
    meta: [
      { title: "Simulador de Compra — Portefólio Tracker" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Simulador de Compra — Portefólio Tracker" },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: Simulador,
});

function Simulador() {
  const fetch = useServerFn(listAssets);
  const { hidden } = usePrivateMode();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetch(),
  });
  const assets = useMemo(() => (data ?? []) as Asset[], [data]);
  const openAssets = useMemo(() => assets.filter(isOpenPosition), [assets]);
  const [amount, setAmount] = useState("250");
  const [cls, setCls] = useState<AssetClass>("etf");
  const [assetId, setAssetId] = useState("");
  const selected = openAssets.find((a) => a.id === assetId);
  // Um ativo existente fixa a classe: não se simula um ETF como se fosse um REIT.
  const assetClass = selected?.class ?? cls;
  const result = useMemo(
    () =>
      analyzePurchase(assets, {
        amount: parseNumberOr(amount, 0),
        assetClass,
        ...(assetId ? { assetId } : {}),
        name: selected?.name ?? "Novo ativo",
      }),
    [assets, amount, assetClass, assetId, selected],
  );
  const money = (v: number) => formatEUR(v, hidden);
  const pct = (v: number) => formatPct(v, 1, hidden);
  const score = (v: number) => (hidden ? "••••" : `${formatNumber(v, 0)}/100`);

  return (
    <div className="space-y-6">
      <PageHeader title="Simulador de Compra" subtitle={DESCRIPTION} />
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
                <KpiGridSkeleton count={6} />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
                <MetricCard label="Carteira atual" value={money(result.currentTotal)} />
                <MetricCard label="Após compra" value={money(result.proposedTotal)} />
                <MetricCard label="Peso da compra" value={pct(result.purchasePct)} />
                <MetricCard
                  label="Diversificação antes"
                  value={score(result.diversificationScoreBefore)}
                />
                <MetricCard
                  label="Diversificação depois"
                  value={score(result.diversificationScoreAfter)}
                />
                <MetricCard label="Maior posição depois" value={pct(result.largestAssetPctAfter)} />
              </div>
            )}
          </div>
          <Card title="Alocação: atual vs. após compra">
            <div className="space-y-3">
              {result.allocation.map((x) => (
                <div key={x.class} className="grid grid-cols-[1fr_auto_auto] gap-4 text-sm">
                  <span>{x.label}</span>
                  <span className="num">
                    {pct(x.currentPct)} → {pct(x.proposedPct)}
                  </span>
                  <span
                    className={x.deltaPct > 0 ? "num text-primary" : "num text-muted-foreground"}
                  >
                    {formatPp(x.deltaPct, 1, hidden)}
                  </span>
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
        </>
      )}
    </div>
  );
}
