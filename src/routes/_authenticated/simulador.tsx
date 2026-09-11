import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listAssets } from "@/lib/portfolio.functions";
import { analyzePurchase } from "@/lib/decision";
import { CLASS_LABELS, type AssetClass, type Asset } from "@/lib/portfolio-types";
import { PageHeader, MetricCard } from "@/components/ui-bits";
import { usePrivateMode } from "@/components/private-mode";
import { formatEUR } from "@/lib/format";
export const Route = createFileRoute("/_authenticated/simulador")({ component: Simulador });
function Simulador() {
  const fetch = useServerFn(listAssets);
  const { hidden } = usePrivateMode();
  const { data } = useQuery({ queryKey: ["assets"], queryFn: () => fetch() });
  const assets = (data ?? []) as Asset[];
  const [amount, setAmount] = useState("250");
  const [cls, setCls] = useState<AssetClass>("etf");
  const [assetId, setAssetId] = useState("");
  const selected = assets.find((a) => a.id === assetId);
  const result = useMemo(
    () =>
      analyzePurchase(assets, {
        amount: Number(amount),
        assetClass: cls,
        ...(assetId ? { assetId } : {}),
        name: selected?.name ?? "Novo ativo",
      }),
    [assets, amount, cls, assetId, selected],
  );
  const money = (v: number) => formatEUR(v, hidden);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulador de Compra"
        subtitle="Testa uma compra antes de alterar a carteira."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 space-y-4 lg:col-span-1">
          <label className="block text-sm font-medium">
            Ativo existente (opcional)
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="mt-2 w-full rounded-lg border bg-background px-3 py-2"
            >
              <option value="">Novo ativo</option>
              {assets
                .filter((a) => a.status !== "closed")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Classe
            <select
              value={cls}
              onChange={(e) => setCls(e.target.value as AssetClass)}
              className="mt-2 w-full rounded-lg border bg-background px-3 py-2"
            >
              {(Object.keys(CLASS_LABELS) as AssetClass[]).map((c) => (
                <option key={c} value={c}>
                  {CLASS_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Montante da compra (€)
            <input
              type="number"
              min="0"
              step="10"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-2 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <p className="text-xs text-muted-foreground">A simulação não grava nada na carteira.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
          <MetricCard label="Carteira atual" value={money(result.currentTotal)} />
          <MetricCard label="Após compra" value={money(result.proposedTotal)} />
          <MetricCard label="Peso da compra" value={`${result.purchasePct.toFixed(1)}%`} />
          <MetricCard
            label="Diversificação antes"
            value={`${result.diversificationScoreBefore.toFixed(0)}/100`}
          />
          <MetricCard
            label="Diversificação depois"
            value={`${result.diversificationScoreAfter.toFixed(0)}/100`}
          />
          <MetricCard
            label="Maior posição depois"
            value={`${result.largestAssetPctAfter.toFixed(1)}%`}
          />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Alocação: atual vs. após compra</h2>
        <div className="space-y-3">
          {result.allocation.map((x) => (
            <div key={x.class} className="grid grid-cols-[1fr_auto_auto] gap-4 text-sm">
              <span>{x.label}</span>
              <span>
                {x.currentPct.toFixed(1)}% → {x.proposedPct.toFixed(1)}%
              </span>
              <span className={x.deltaPct > 0 ? "text-primary" : "text-muted-foreground"}>
                {x.deltaPct >= 0 ? "+" : ""}
                {x.deltaPct.toFixed(1)} pp
              </span>
            </div>
          ))}
        </div>
      </div>
      {result.alerts.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <h2 className="mb-2 text-sm font-semibold">Alertas</h2>
          <ul className="space-y-1 text-sm">
            {result.alerts.map((a) => (
              <li key={a}>• {a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
