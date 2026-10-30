import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { Asset, Dividend } from "@/lib/portfolio-types";
import { listDividends } from "@/lib/portfolio.functions";
import {
  grossOf,
  isReceived,
  lastDividend,
  nextDividend,
  totalReceived,
  totalScheduled,
} from "@/lib/dividends";
import { formatDatePt, formatEUR, formatPct, formatQuantity } from "@/lib/format";
import { netYield, realYield, yieldOnCost } from "@/lib/real-yield";
import { withholdingRateFor } from "@/lib/tax";
import { todayLisbon } from "@/lib/dates";
import { privateEUR } from "@/components/private-value";

export interface PositionLot {
  id?: string;
  originalQuantity: number;
  quantity: number;
  unitCost: number;
  traded_at: string;
}

/** Dividendos de um ativo: totais, último, próximo e a lista. */
export function PositionDividends({
  assetId,
  asset,
  hidden,
}: {
  assetId: string;
  /** Com o ativo, mostra também os yields reais (atual, 12 meses, sobre o custo e líquido). */
  asset?: Asset;
  hidden: boolean;
}) {
  const dividendsFn = useServerFn(listDividends);
  const { data: allDividends } = useQuery({
    queryKey: ["dividends"],
    queryFn: () => dividendsFn(),
  });

  const assetDividends = useMemo(
    () =>
      ((allDividends ?? []) as Dividend[])
        .filter((d) => d.asset_id === assetId)
        .sort((a, b) => (b.payment_date ?? b.paid_at).localeCompare(a.payment_date ?? a.paid_at)),
    [allDividends, assetId],
  );

  const divStats = useMemo(() => {
    const rows = assetDividends as never[];
    return {
      received: totalReceived(rows),
      scheduled: totalScheduled(rows),
      last: lastDividend(rows) as (Dividend & { payment_date?: string | null }) | null,
      next: nextDividend(rows) as (Dividend & { payment_date?: string | null }) | null,
    };
  }, [assetDividends]);

  const yields = useMemo(() => {
    if (!asset) return null;
    const price = Number(asset.current_price_native) || 0;
    const real = realYield(assetDividends, price, todayLisbon());
    const fx =
      Number(asset.fx_rate) > 0
        ? Number(asset.fx_rate)
        : price > 0
          ? (Number(asset.current_price) || 0) / price
          : 0;
    const wht = withholdingRateFor(asset).rate;
    const forwardPct = real?.forwardPct ?? (Number(asset.annual_yield) || null);
    return {
      real,
      forwardPct,
      onCost: real ? yieldOnCost(real.forwardDps, fx, Number(asset.average_price) || 0) : null,
      net: forwardPct != null ? netYield(forwardPct, wht) : null,
      wht,
    };
  }, [asset, assetDividends]);

  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Dividendos
      </h3>
      {yields && yields.forwardPct != null && (
        <>
          <div className="mb-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <YieldTile
              label="Yield atual"
              value={yields.forwardPct}
              hint="Último dividendo regular × frequência ÷ cotação. Sem dividendos especiais."
            />
            <YieldTile
              label={yields.real?.ttmPartial ? "Últimos 12 m (parcial)" : "Últimos 12 meses"}
              value={yields.real?.ttmPct ?? null}
              hint="Tudo o que foi pago por ação nos últimos 12 meses, incluindo especiais."
            />
            <YieldTile
              label="Sobre o custo"
              value={yields.onCost}
              hint="Dividendo anual regular, em euros ao câmbio de hoje, ÷ o teu preço médio."
            />
            <YieldTile
              label="Líquido (estim.)"
              value={yields.net}
              hint={`Depois de impostos: retenção na origem de ${Math.round(yields.wht * 100)}% e taxa de 28% em Portugal (sem englobamento).`}
            />
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            {yields.real
              ? `Calculado com os dividendos recebidos (${yields.real.frequency?.toLowerCase() ?? "frequência irregular"}).`
              : "Estimativa pelo histórico do Yahoo: ainda não há pagamentos suficientes no extrato."}
            {yields.real && yields.real.ttmSpecialDps > 0
              ? ` Inclui dividendos especiais de ${formatQuantity(yields.real.ttmSpecialDps, 4)} ${asset?.native_currency ?? ""} por ação nos últimos 12 meses, que não entram no yield atual.`
              : ""}
          </p>
        </>
      )}
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">Recebidos</div>
          <div className="font-medium text-success">{privateEUR(divStats.received, hidden)}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">Previstos</div>
          <div className="font-medium">{privateEUR(divStats.scheduled, hidden)}</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">Último</div>
          <div className="font-medium">
            {divStats.last
              ? `${formatEUR(grossOf(divStats.last), hidden)} · ${divStats.last.payment_date ?? divStats.last.paid_at}`
              : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">Próximo</div>
          <div className="font-medium">
            {divStats.next
              ? `${formatEUR(grossOf(divStats.next), hidden)} · ${divStats.next.payment_date ?? divStats.next.paid_at}`
              : "—"}
          </div>
        </div>
      </div>
      {assetDividends.length > 0 && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
          {assetDividends.map((d) => (
            <li key={d.id} className="flex justify-between">
              <span>{d.payment_date ?? d.paid_at}</span>
              <span>
                {privateEUR(grossOf(d as never), hidden)}{" "}
                {isReceived(d as never) ? "" : "(previsto)"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function YieldTile({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <div className="rounded-lg border border-border p-3" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="num font-medium">{value == null ? "—" : formatPct(value, 2)}</div>
    </div>
  );
}

/** Lotes FIFO ainda abertos. */
export function OpenLots({ lots, hidden }: { lots: PositionLot[]; hidden: boolean }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Lotes abertos
      </h3>
      {lots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem lotes abertos — posição fechada.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr className="border-b border-border text-left">
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 text-right font-medium">Original</th>
                <th className="px-3 py-2 text-right font-medium">Restante</th>
                <th className="px-3 py-2 text-right font-medium">Custo/un.</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l, i) => (
                <tr key={l.id ?? i} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">{formatDatePt(l.traded_at)}</td>
                  <td className="px-3 py-2 text-right">{formatQuantity(l.originalQuantity)}</td>
                  <td className="px-3 py-2 text-right">{formatQuantity(l.quantity)}</td>
                  <td className="px-3 py-2 text-right">{privateEUR(l.unitCost, hidden)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
