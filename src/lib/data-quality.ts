/**
 * Alertas de qualidade de dados — lógica pura, determinística e testável.
 * Não corrige nada: só aponta o que pode distorcer os números da carteira.
 */

import { addDaysISO } from "@/lib/dates";
import { replayLedger, totalQuantity, type LedgerEntry } from "@/lib/fifo";
import { withholdingRateFor, type TaxableAsset } from "@/lib/tax";

export type AlertSeverity = "error" | "warning" | "info";

export type AlertCode =
  | "ledger_mismatch"
  | "ledger_invalid"
  | "stale_price"
  | "missing_price"
  | "missing_ticker"
  | "missing_isin"
  | "etf_no_holdings"
  | "etf_low_coverage"
  | "dividend_without_tax"
  | "unknown_withholding"
  | "estimated_payment_dates"
  | "fx_unconfirmed"
  | "p2p_stale_import";

export interface DataQualityAlert {
  code: AlertCode;
  severity: AlertSeverity;
  message: string;
  assetId?: string;
  assetName?: string;
  /** Número de registos afetados (quando aplicável). */
  count?: number;
}

/** Identifica um aviso; se a mensagem mudar (ex.: nova contagem), volta a aparecer. */
export const alertKey = (a: DataQualityAlert) => `${a.code}|${a.assetId ?? ""}|${a.message}`;

export interface DqAsset extends TaxableAsset {
  id: string;
  name: string;
  class: string;
  status: string;
  quantity: number;
  current_price: number;
  price_updated_at?: string | null;
}

export interface DqTransaction extends LedgerEntry {
  asset_id: string | null;
  native_currency?: string | null;
  fx_source?: string | null;
}

export interface DqDividend {
  asset_id: string | null;
  gross_amount?: number | null;
  amount: number;
  tax_amount?: number | null;
  status?: string | null;
  payment_date_estimated?: boolean | null;
}

export interface DqInput {
  assets: DqAsset[];
  transactions: DqTransaction[];
  dividends: DqDividend[];
  /** Soma dos pesos das holdings conhecidas por ETF (0..1). */
  holdingsCoverage: Map<string, number>;
  today: string;
  /** Dias até um preço ser considerado desatualizado. */
  stalePriceDays?: number;
  /** P2P importado (Scramble): data do último movimento por ativo. */
  p2pLastMovement?: Map<string, string>;
}

/** Sem importar há mais de um mês, o calendário e os juros ficam desatualizados. */
const P2P_STALE_DAYS = 40;

const SEVERITY_ORDER: Record<AlertSeverity, number> = { error: 0, warning: 1, info: 2 };

const isSecurity = (cls: string) => cls !== "p2p" && cls !== "metal";

export function dataQualityAlerts(input: DqInput): DataQualityAlert[] {
  const { assets, transactions, dividends, holdingsCoverage, today } = input;
  const staleDays = input.stalePriceDays ?? 3;
  const staleCutoff = addDaysISO(today, -staleDays);
  const out: DataQualityAlert[] = [];

  const txByAsset = new Map<string, DqTransaction[]>();
  for (const t of transactions) {
    if (!t.asset_id) continue;
    const list = txByAsset.get(t.asset_id) ?? [];
    list.push(t);
    txByAsset.set(t.asset_id, list);
  }

  for (const a of assets) {
    const open = a.status !== "closed" && (Number(a.quantity) || 0) > 0;
    const ref = { assetId: a.id, assetName: a.name };

    // Livro de movimentos vs agregados guardados.
    const txs = txByAsset.get(a.id) ?? [];
    if (txs.length > 0 && isSecurity(a.class)) {
      try {
        const held = totalQuantity(replayLedger(txs).lots);
        if (Math.abs(held - (Number(a.quantity) || 0)) > 1e-6) {
          out.push({
            ...ref,
            code: "ledger_mismatch",
            severity: "error",
            message: `Quantidade guardada (${a.quantity}) difere do livro de movimentos (${Number(held.toFixed(6))}).`,
          });
        }
      } catch (e) {
        out.push({
          ...ref,
          code: "ledger_invalid",
          severity: "error",
          message: e instanceof Error ? e.message : "Livro de movimentos inválido.",
        });
      }
    }

    // P2P não tem quantidade: conta como aberto enquanto não estiver fechado.
    const p2pLast =
      a.class === "p2p" && a.status !== "closed" ? input.p2pLastMovement?.get(a.id) : undefined;
    if (p2pLast && p2pLast < addDaysISO(today, -P2P_STALE_DAYS)) {
      out.push({
        ...ref,
        code: "p2p_stale_import",
        severity: "warning",
        message: `Último movimento importado a ${p2pLast}: importa os relatórios mais recentes da plataforma.`,
      });
    }

    if (!open) continue;

    if (a.class !== "p2p") {
      if (!(Number(a.current_price) > 0)) {
        out.push({ ...ref, code: "missing_price", severity: "error", message: "Sem preço atual." });
      } else if (!a.price_updated_at || a.price_updated_at.slice(0, 10) < staleCutoff) {
        out.push({
          ...ref,
          code: "stale_price",
          severity: "warning",
          message: a.price_updated_at
            ? `Preço com mais de ${staleDays} dias (última atualização ${a.price_updated_at.slice(0, 10)}).`
            : "Preço nunca atualizado automaticamente.",
        });
      }
    }

    if (isSecurity(a.class) && !a.ticker) {
      out.push({
        ...ref,
        code: "missing_ticker",
        severity: "warning",
        message: "Sem ticker: preços e dividendos não são atualizados.",
      });
    }

    if (a.class === "etf") {
      if (!a.isin) {
        out.push({
          ...ref,
          code: "missing_isin",
          severity: "info",
          message: "ETF sem ISIN: a composição (justETF/FT) não pode ser obtida.",
        });
      }
      const coverage = holdingsCoverage.get(a.id) ?? 0;
      if (coverage <= 0) {
        out.push({
          ...ref,
          code: "etf_no_holdings",
          severity: "warning",
          message: "ETF sem holdings conhecidas: o look-through e a concentração ignoram-no.",
        });
      } else if (coverage < 0.5) {
        out.push({
          ...ref,
          code: "etf_low_coverage",
          severity: "info",
          message: `Composição conhecida cobre só ${Math.round(coverage * 100)}% do ETF.`,
        });
      }
    }
  }

  // Dividendos sem retenção quando o país do emitente retém na fonte.
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const noTax = new Map<string, number>();
  const estimated = new Map<string, number>();
  const unknownWht = new Set<string>();
  for (const d of dividends) {
    if (!d.asset_id) continue;
    const a = assetById.get(d.asset_id);
    if (!a) continue;
    const gross = Number(d.gross_amount ?? d.amount) || 0;
    if (gross <= 0) continue;
    const wht = withholdingRateFor(a);
    if (wht.source === "unknown") unknownWht.add(a.id);
    if (wht.rate > 0 && !(Number(d.tax_amount ?? 0) > 0)) {
      noTax.set(a.id, (noTax.get(a.id) ?? 0) + 1);
    }
    if (d.payment_date_estimated) estimated.set(a.id, (estimated.get(a.id) ?? 0) + 1);
  }
  for (const [id, count] of noTax) {
    const a = assetById.get(id)!;
    out.push({
      assetId: id,
      assetName: a.name,
      code: "dividend_without_tax",
      severity: "warning",
      count,
      message: `${count} dividendo(s) sem retenção na fonte registada (esperada ${Math.round(withholdingRateFor(a).rate * 1000) / 10}%). Corre o recálculo de dividendos.`,
    });
  }
  for (const id of unknownWht) {
    const a = assetById.get(id)!;
    out.push({
      assetId: id,
      assetName: a.name,
      code: "unknown_withholding",
      severity: "info",
      message: "País do emitente desconhecido: define a retenção na fonte do ativo.",
    });
  }
  const estimatedTotal = [...estimated.values()].reduce((s, n) => s + n, 0);
  if (estimatedTotal > 0) {
    out.push({
      code: "estimated_payment_dates",
      severity: "info",
      count: estimatedTotal,
      message: `${estimatedTotal} dividendo(s) com data de pagamento estimada (ex-date + 14 dias). Importa o extrato XTB para confirmar.`,
    });
  }

  // Câmbio de movimentos em moeda estrangeira por confirmar.
  const unconfirmed = transactions.filter(
    (t) =>
      (t.native_currency ?? "EUR").toUpperCase() !== "EUR" &&
      (t.fx_source == null || t.fx_source === "current_fallback"),
  ).length;
  if (unconfirmed > 0) {
    out.push({
      code: "fx_unconfirmed",
      severity: "warning",
      count: unconfirmed,
      message: `${unconfirmed} movimento(s) em moeda estrangeira sem câmbio da data confirmado (afeta o IRS).`,
    });
  }

  return out.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.assetName ?? "").localeCompare(b.assetName ?? ""),
  );
}
