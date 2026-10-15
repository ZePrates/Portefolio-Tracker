import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { MetalSummary } from "@/lib/metals";
import { formatDatePt, formatNumber, formatPct, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { privateEUR, privateText } from "@/components/private-value";

export interface MetalExpenseRow {
  id: string;
  incurred_at: string;
  amount: number;
  grams_deducted: number;
  price_per_gram: number | null;
  notes: string | null;
}

/** Espaço inquebrável entre número e unidade. */
const NBSP = String.fromCharCode(0xa0);

const tone = (v: number) =>
  v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground";

/** Preço por grama com 4 casas (os metais mexem-se ao cêntimo de cêntimo). */
const perGram = (v: number, hidden: boolean) =>
  privateText(`${formatNumber(v, 4)}${NBSP}€/g`, hidden, `00,0000${NBSP}€/g`);

const grams = (v: number, hidden = false) =>
  privateText(`${formatNumber(v, 2)}${NBSP}g`, hidden, `000,00${NBSP}g`);

/**
 * Ficha de um metal em custódia: quanto se pagou (ágio incluído), quanto
 * vale hoje à recompra, de onde vem o resultado e o histórico de taxas
 * pagas em gramas.
 */
export function MetalPositionPanel({
  summary: s,
  expenses,
  custody,
  hidden,
  onDeleteExpense,
}: {
  summary: MetalSummary;
  expenses: MetalExpenseRow[];
  custody: { custodian: string | null; vault_ref: string | null; plan_name: string | null };
  hidden: boolean;
  onDeleteExpense: (e: MetalExpenseRow) => void;
}) {
  const custodyLine = [custody.custodian, custody.plan_name, custody.vault_ref]
    .filter(Boolean)
    .join(" · ");
  const discountPct = s.discount * 100;

  return (
    <div className="space-y-5">
      {custodyLine && <p className="text-xs text-muted-foreground">Custódia: {custodyLine}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="No cofre"
          value={grams(s.gramsHeld, hidden)}
          sub={
            <>
              {grams(s.gramsBought, hidden)} comprados − {grams(s.gramsDeducted, hidden)} em taxas
            </>
          }
        />
        <Stat
          label="Pago (ágio incluído)"
          value={privateEUR(s.invested, hidden)}
          sub={<>custo real {perGram(s.avgCostPerGram, hidden)}</>}
        />
        <Stat
          label="Valor de recompra"
          value={privateEUR(s.valueAtBuyback, hidden)}
          sub={<>ao spot {privateEUR(s.valueAtSpot, hidden)}</>}
        />
        <Stat
          label="Ganho/perda não realizado"
          value={privateEUR(s.unrealizedPL, hidden)}
          sub={formatPct(s.unrealizedPct * 100, 1)}
          className={tone(s.unrealizedPL)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Spot {perGram(s.spot, hidden)} · recompra {perGram(s.buyback, hidden)} (spot −{" "}
        {formatNumber(discountPct, 2)}&nbsp;%). O valor no portefólio é o de recompra — o que
        recebes se venderes hoje.
      </p>

      {s.breakdown && (
        <section>
          <SectionTitle>De onde vem o resultado</SectionTitle>
          <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
            <Row
              label="Variação do preço desde cada compra"
              value={privateEUR(s.breakdown.priceEffect, hidden)}
              className={tone(s.breakdown.priceEffect)}
            />
            <Row
              label="Ágio pago nas compras"
              value={privateEUR(s.breakdown.premium, hidden)}
              className={tone(s.breakdown.premium)}
            />
            <Row
              label={<>Armazenamento ({grams(s.gramsDeducted, hidden)} ao preço de hoje)</>}
              value={privateEUR(s.breakdown.storage, hidden)}
              className={tone(s.breakdown.storage)}
            />
            <Row
              label={`Desconto de recompra (${formatNumber(discountPct, 2)} %)`}
              value={privateEUR(s.breakdown.spread, hidden)}
              className={tone(s.breakdown.spread)}
            />
            <div className="border-t border-border pt-1">
              <Row
                label="Total"
                value={privateEUR(s.unrealizedPL, hidden)}
                className={cn("font-medium", tone(s.unrealizedPL))}
              />
            </div>
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Compras</SectionTitle>
        {s.lots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem compras em aberto.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border text-left">
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 text-right font-medium">Pago</th>
                  <th className="px-3 py-2 text-right font-medium">€/g pago</th>
                  <th className="px-3 py-2 text-right font-medium">Spot</th>
                  <th className="px-3 py-2 text-right font-medium">Ágio</th>
                  <th className="px-3 py-2 text-right font-medium">Gramas</th>
                  <th className="px-3 py-2 text-right font-medium">Hoje</th>
                  <th className="px-3 py-2 text-right font-medium">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {s.lots.map((l) => (
                  <tr key={l.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">{formatDatePt(l.traded_at)}</td>
                    <td className="px-3 py-2 text-right">{privateEUR(l.paid, hidden)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(l.paidPerGram, 4)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(l.spotAtPurchase, 4)}</td>
                    <td className="px-3 py-2 text-right">
                      {l.premiumRate != null ? formatPct(l.premiumRate * 100, 2) : "—"}
                    </td>
                    <td
                      className="px-3 py-2 text-right"
                      title={`Comprados ${formatQuantity(l.gramsBought)} g`}
                    >
                      {formatNumber(l.gramsNow, 2)}
                    </td>
                    <td className="px-3 py-2 text-right">{privateEUR(l.valueNow, hidden)}</td>
                    <td className={cn("px-3 py-2 text-right", tone(l.pl))}>
                      {privateEUR(l.pl, hidden)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Custódia coletiva: cada taxa retira gramas a todas as compras na proporção; o valor pago
          por compra mantém-se.
        </p>
      </section>

      <section>
        <SectionTitle>
          Taxas de armazenamento · {privateEUR(s.storageBilled, hidden)} ·{" "}
          {grams(s.gramsDeducted, hidden)}
        </SectionTitle>
        {expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem taxas registadas.</p>
        ) : (
          <div className="max-h-56 overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-popover text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border text-left">
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 text-right font-medium">Gramas</th>
                  <th className="px-3 py-2 text-right font-medium">€/g</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">{formatDatePt(e.incurred_at)}</td>
                    <td className="px-3 py-2 text-right">
                      {Number(e.grams_deducted) > 0
                        ? `−${formatNumber(Number(e.grams_deducted), 2)}`
                        : "pago em €"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {e.price_per_gram != null ? formatNumber(Number(e.price_per_gram), 4) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">{privateEUR(Number(e.amount), hidden)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          aria-label="Apagar taxa"
                          title="Apagar"
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                          onClick={() => onDeleteExpense(e)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-medium", className)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Row({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={className}>{value}</span>
    </div>
  );
}
