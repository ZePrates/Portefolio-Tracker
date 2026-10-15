import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { Dividend } from "@/lib/portfolio-types";
import { listDividends } from "@/lib/portfolio.functions";
import {
  grossOf,
  isReceived,
  lastDividend,
  nextDividend,
  totalReceived,
  totalScheduled,
} from "@/lib/dividends";
import { formatDatePt, formatEUR, formatQuantity } from "@/lib/format";
import { privateEUR } from "@/components/private-value";

export interface PositionLot {
  id?: string;
  originalQuantity: number;
  quantity: number;
  unitCost: number;
  traded_at: string;
}

/** Dividendos de um ativo: totais, último, próximo e a lista. */
export function PositionDividends({ assetId, hidden }: { assetId: string; hidden: boolean }) {
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

  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Dividendos
      </h3>
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
