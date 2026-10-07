/**
 * Import do extrato XTB ("Cash Operations" / histórico de operações de caixa),
 * exportado em CSV (separador ";" ou ","). Lógica pura e testável.
 *
 * Colunas esperadas (nomes em inglês do export XTB): ID, Type, Time, Symbol,
 * Comment, Amount. "Amount" vem na moeda da conta (EUR) — por isso o câmbio
 * efetivo de cada operação é o real do broker, que é o que conta para o IRS.
 *
 *   Stock purchase  "OPEN BUY 5 @ 102.34"        Amount −… (custo em EUR)
 *   Stock sale      "CLOSE BUY 5 @ 110.00"       Amount +… (produto em EUR)
 *   DIVIDENT        "AAPL.US USD 0.2500/ SHR"    Amount +… (bruto em EUR)
 *   Withholding Tax "AAPL.US USD WHT 15%"        Amount −… (retenção em EUR)
 */

import { parseNumberPt } from "@/lib/format";
import { isValidISODate } from "@/lib/dates";

export interface XtbTrade {
  sourceId: string;
  kind: "buy" | "sell";
  date: string;
  symbol: string;
  quantity: number;
  /** Preço por unidade na moeda do título (do comentário). */
  priceNative: number;
  /** Valor total em EUR (custo da compra ou produto da venda), positivo. */
  amountEur: number;
  /** Preço efetivo em EUR por unidade (inclui custos de conversão). */
  priceEur: number;
  /** Câmbio efetivo: 1 unidade nativa = x EUR. */
  fxRate: number;
}

export interface XtbDividend {
  sourceId: string;
  date: string;
  symbol: string;
  grossEur: number;
  taxEur: number;
  netEur: number;
  currency: string | null;
  perShareNative: number | null;
}

export interface XtbParseResult {
  trades: XtbTrade[];
  dividends: XtbDividend[];
  ignored: Array<{ type: string; count: number }>;
  errors: Array<{ line: number; message: string }>;
}

/** Divide uma linha CSV respeitando aspas. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(header: string): string {
  const counts = [";", ",", "\t"].map((d) => [d, header.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![0];
}

/** "02.01.2025 15:30:01" | "2025-01-02 15:30:01" | "02/01/2025" → "2025-01-02". */
export function parseXtbDate(value: string): string | null {
  const v = value.trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(v);
  if (m) {
    const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    return isValidISODate(iso) ? iso : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return isValidISODate(iso) ? iso : null;
  }
  return null;
}

const TRADE_RE = /(OPEN|CLOSE)\s+BUY\s+([\d.,]+)(?:\s*\/\s*[\d.,]+)?\s*@\s*([\d.,]+)/i;
const DIV_RE = /\b([A-Z]{3})\s+([\d.,]+)\s*\/\s*SHR/i;

const kindOf = (type: string): "buy" | "sell" | "dividend" | "withholding" | null => {
  const t = type.trim().toLowerCase();
  if (/purchase/.test(t)) return "buy";
  if (/sale/.test(t)) return "sell";
  if (/^divid/.test(t)) return "dividend"; // "DIVIDENT" (sic) no export XTB
  if (/withholding/.test(t)) return "withholding";
  return null;
};

export function parseXtbCashOperations(csv: string): XtbParseResult {
  // Remove o BOM (U+FEFF) que o Excel acrescenta ao exportar CSV.
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const lines = text.split(/\r?\n/);
  const result: XtbParseResult = { trades: [], dividends: [], ignored: [], errors: [] };

  const headerIdx = lines.findIndex(
    (l) => /\bid\b/i.test(l) && /\btype\b/i.test(l) && /amount/i.test(l),
  );
  if (headerIdx < 0) {
    result.errors.push({
      line: 0,
      message: "Cabeçalho não encontrado (esperado: ID, Type, Time, Symbol, Comment, Amount).",
    });
    return result;
  }
  const delimiter = detectDelimiter(lines[headerIdx]!);
  const header = splitCsvLine(lines[headerIdx]!, delimiter).map((h) => h.toLowerCase());
  const col = (name: string) => header.findIndex((h) => h === name || h.startsWith(name));
  const idx = {
    id: col("id"),
    type: col("type"),
    time: col("time"),
    symbol: col("symbol"),
    comment: col("comment"),
    amount: col("amount"),
  };
  if (Object.values(idx).some((i) => i < 0)) {
    result.errors.push({
      line: headerIdx + 1,
      message: "Faltam colunas obrigatórias no cabeçalho.",
    });
    return result;
  }

  const ignored = new Map<string, number>();
  const withholding = new Map<string, number>();
  const rawDividends: Array<Omit<XtbDividend, "taxEur" | "netEur">> = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const cells = splitCsvLine(line, delimiter);
    const get = (k: keyof typeof idx) => cells[idx[k]] ?? "";
    const type = get("type");
    // Linha de totais no fim do export.
    if (!type || /^total/i.test(get("id")) || /^total/i.test(type)) continue;
    const kind = kindOf(type);
    if (!kind) {
      ignored.set(type, (ignored.get(type) ?? 0) + 1);
      continue;
    }
    const lineNo = i + 1;
    const date = parseXtbDate(get("time"));
    const amount = parseNumberPt(get("amount"));
    const symbol = get("symbol").toUpperCase();
    const sourceId = get("id");
    if (!date || !Number.isFinite(amount) || !symbol || !sourceId) {
      result.errors.push({ line: lineNo, message: `Linha inválida (${type}).` });
      continue;
    }

    if (kind === "buy" || kind === "sell") {
      const m = TRADE_RE.exec(get("comment"));
      const quantity = m ? parseNumberPt(m[2]!) : Number.NaN;
      const priceNative = m ? parseNumberPt(m[3]!) : Number.NaN;
      if (!(quantity > 0) || !(priceNative > 0)) {
        result.errors.push({
          line: lineNo,
          message: `Comentário sem quantidade/preço: "${get("comment")}".`,
        });
        continue;
      }
      const amountEur = Math.abs(amount);
      result.trades.push({
        sourceId,
        kind,
        date,
        symbol,
        quantity,
        priceNative,
        amountEur,
        priceEur: amountEur / quantity,
        fxRate: amountEur / (quantity * priceNative),
      });
    } else if (kind === "withholding") {
      const key = `${symbol}|${date}`;
      withholding.set(key, (withholding.get(key) ?? 0) + Math.abs(amount));
    } else {
      const m = DIV_RE.exec(get("comment"));
      rawDividends.push({
        sourceId,
        date,
        symbol,
        grossEur: Math.abs(amount),
        currency: m ? m[1]!.toUpperCase() : null,
        perShareNative: m ? parseNumberPt(m[2]!) : null,
      });
    }
  }

  // Junta cada retenção ao dividendo do mesmo título e data.
  const usedKeys = new Set<string>();
  for (const d of rawDividends) {
    const key = `${d.symbol}|${d.date}`;
    const tax = usedKeys.has(key) ? 0 : (withholding.get(key) ?? 0);
    usedKeys.add(key);
    result.dividends.push({ ...d, taxEur: tax, netEur: d.grossEur - tax });
  }
  for (const key of withholding.keys()) {
    if (!usedKeys.has(key)) {
      result.errors.push({
        line: 0,
        message: `Retenção sem dividendo correspondente (${key.replace("|", " em ")}).`,
      });
    }
  }

  result.ignored = [...ignored.entries()].map(([type, count]) => ({ type, count }));
  return result;
}

/* ------------------------------------------------------------------ */
/* Correspondência de símbolos XTB → ativos da carteira               */
/* ------------------------------------------------------------------ */

/** Sufixos XTB → Yahoo. */
const XTB_TO_YAHOO: Readonly<Record<string, string>> = {
  US: "",
  UK: ".L",
  NL: ".AS",
  DE: ".DE",
  FR: ".PA",
  ES: ".MC",
  IT: ".MI",
  PT: ".LS",
  BE: ".BR",
  CH: ".SW",
  DK: ".CO",
  SE: ".ST",
  NO: ".OL",
  FI: ".HE",
  PL: ".WA",
  IE: ".IR",
};

export function xtbToYahoo(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const dot = s.lastIndexOf(".");
  if (dot < 0) return s;
  const suffix = XTB_TO_YAHOO[s.slice(dot + 1)];
  return suffix === undefined ? s : `${s.slice(0, dot)}${suffix}`;
}

export interface MatchableAsset {
  id: string;
  ticker: string | null;
  price_source?: string | null;
}

const baseOf = (s: string) => s.split(".")[0]!;

/**
 * Encontra o ativo de um símbolo XTB: símbolo Yahoo exato (do price_source ou
 * do ticker) e, na falta, o mesmo símbolo-base sem bolsa se for único.
 */
export function matchXtbSymbol(symbol: string, assets: MatchableAsset[]): string | null {
  const target = xtbToYahoo(symbol);
  const yahooOf = (a: MatchableAsset) =>
    (a.price_source?.startsWith("yahoo:")
      ? a.price_source.slice(6)
      : xtbToYahoo(a.ticker ?? "")
    ).toUpperCase();
  const exact = assets.filter(
    (a) => yahooOf(a) === target || (a.ticker ?? "").toUpperCase() === symbol.toUpperCase(),
  );
  if (exact.length === 1) return exact[0]!.id;
  const base = baseOf(target);
  const byBase = assets.filter(
    (a) => baseOf(yahooOf(a)) === base || baseOf((a.ticker ?? "").toUpperCase()) === base,
  );
  return byBase.length === 1 ? byBase[0]!.id : null;
}

/* ------------------------------------------------------------------ */
/* Plano de importação (puro): o que inserir, conciliar ou ignorar      */
/* ------------------------------------------------------------------ */

export interface ExistingTx {
  id: string;
  asset_id: string | null;
  type: string;
  quantity: number;
  price: number;
  fee?: number | null;
  traded_at: string;
  created_at?: string;
  source?: string | null;
  source_event_id?: string | null;
}

export interface ExistingDividend {
  id: string;
  asset_id: string | null;
  source: string;
  source_event_id: string | null;
  ex_date: string | null;
  payment_date_estimated: boolean;
}

export type TradeAction =
  /** Movimento novo. */
  | "insert"
  /** Já existe um movimento manual igual: atualiza-o com os valores reais do broker. */
  | "reconcile"
  /** Já importado antes (mesmo ID XTB). */
  | "duplicate"
  /** Símbolo sem ativo correspondente na carteira. */
  | "unmatched"
  /** O livro do ativo ficaria inválido (ex.: vender mais do que se detém). */
  | "blocked";

export interface PlannedTrade {
  trade: XtbTrade;
  assetId: string | null;
  action: TradeAction;
  reconcileTxId?: string;
  reason?: string;
}

export type DividendAction = "insert" | "confirm" | "duplicate" | "unmatched";

export interface PlannedDividend {
  dividend: XtbDividend;
  assetId: string | null;
  action: DividendAction;
  /** Registo estimado (Yahoo) que este dividendo confirma. */
  confirmDividendId?: string;
}

export interface XtbImportPlan {
  trades: PlannedTrade[];
  dividends: PlannedDividend[];
  unmatchedSymbols: string[];
  summary: Record<TradeAction | `dividend_${DividendAction}`, number>;
}

export const xtbEventId = (sourceId: string) => `xtb:${sourceId}`;

/** Janela máxima entre ex-date (Yahoo) e pagamento (XTB) para os associar. */
const DIVIDEND_MATCH_DAYS = 75;

export function planXtbImport(input: {
  parsed: XtbParseResult;
  assets: MatchableAsset[];
  existingTransactions: ExistingTx[];
  existingDividends: ExistingDividend[];
  /** Valida o livro resultante de um ativo; lança com a razão se for inválido. */
  validateLedger: (entries: ExistingTx[]) => void;
}): XtbImportPlan {
  const { parsed, assets, existingTransactions, existingDividends } = input;
  const symbolToAsset = new Map<string, string | null>();
  const assetFor = (symbol: string) => {
    if (!symbolToAsset.has(symbol)) symbolToAsset.set(symbol, matchXtbSymbol(symbol, assets));
    return symbolToAsset.get(symbol) ?? null;
  };

  const importedTx = new Set(existingTransactions.map((t) => t.source_event_id).filter(Boolean));
  const usedManual = new Set<string>();

  const trades: PlannedTrade[] = parsed.trades
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.sourceId.localeCompare(b.sourceId))
    .map((trade): PlannedTrade => {
      const assetId = assetFor(trade.symbol);
      if (!assetId) return { trade, assetId, action: "unmatched" };
      if (importedTx.has(xtbEventId(trade.sourceId)))
        return { trade, assetId, action: "duplicate" };
      const manual = existingTransactions.find(
        (t) =>
          t.asset_id === assetId &&
          !t.source_event_id &&
          !usedManual.has(t.id) &&
          t.type === trade.kind &&
          t.traded_at.slice(0, 10) === trade.date &&
          Math.abs(Number(t.quantity) - trade.quantity) < 1e-6,
      );
      if (manual) {
        usedManual.add(manual.id);
        return { trade, assetId, action: "reconcile", reconcileTxId: manual.id };
      }
      return { trade, assetId, action: "insert" };
    });

  // Valida o livro de cada ativo afetado com as alterações propostas.
  const writes = (t: PlannedTrade) => t.action === "insert" || t.action === "reconcile";
  const affected = new Set(trades.filter(writes).map((t) => t.assetId!));
  for (const assetId of affected) {
    const mine = trades.filter((t) => t.assetId === assetId && writes(t));
    const reconciled = new Map(
      mine.filter((t) => t.reconcileTxId).map((t) => [t.reconcileTxId!, t.trade] as const),
    );
    const entries: ExistingTx[] = existingTransactions
      .filter((t) => t.asset_id === assetId)
      .map((t) => {
        const r = reconciled.get(t.id);
        return r ? { ...t, price: r.priceEur, fee: 0 } : t;
      });
    for (const t of mine.filter((m) => m.action === "insert")) {
      entries.push({
        id: xtbEventId(t.trade.sourceId),
        asset_id: assetId,
        type: t.trade.kind,
        quantity: t.trade.quantity,
        price: t.trade.priceEur,
        fee: 0,
        traded_at: t.trade.date,
      });
    }
    try {
      input.validateLedger(entries);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Livro inválido.";
      for (const t of mine) {
        t.action = "blocked";
        t.reason = reason;
        delete t.reconcileTxId;
      }
    }
  }

  const importedDiv = new Set(existingDividends.map((d) => d.source_event_id).filter(Boolean));
  const usedEstimated = new Set<string>();
  const dividends: PlannedDividend[] = parsed.dividends.map((dividend): PlannedDividend => {
    const assetId = assetFor(dividend.symbol);
    if (!assetId) return { dividend, assetId, action: "unmatched" };
    if (importedDiv.has(xtbEventId(dividend.sourceId))) {
      return { dividend, assetId, action: "duplicate" };
    }
    const from = new Date(`${dividend.date}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - DIVIDEND_MATCH_DAYS);
    const fromIso = from.toISOString().slice(0, 10);
    const candidate = existingDividends
      .filter(
        (d) =>
          d.asset_id === assetId &&
          d.payment_date_estimated &&
          !usedEstimated.has(d.id) &&
          d.ex_date != null &&
          d.ex_date <= dividend.date &&
          d.ex_date >= fromIso,
      )
      .sort((a, b) => (b.ex_date ?? "").localeCompare(a.ex_date ?? ""))[0];
    if (candidate) {
      usedEstimated.add(candidate.id);
      return { dividend, assetId, action: "confirm", confirmDividendId: candidate.id };
    }
    return { dividend, assetId, action: "insert" };
  });

  const count = (rows: Array<{ action: string }>, a: string) =>
    rows.filter((r) => r.action === a).length;
  return {
    trades,
    dividends,
    unmatchedSymbols: [...symbolToAsset.entries()]
      .filter(([, v]) => v == null)
      .map(([k]) => k)
      .sort(),
    summary: {
      insert: count(trades, "insert"),
      reconcile: count(trades, "reconcile"),
      duplicate: count(trades, "duplicate"),
      unmatched: count(trades, "unmatched"),
      blocked: count(trades, "blocked"),
      dividend_insert: count(dividends, "insert"),
      dividend_confirm: count(dividends, "confirm"),
      dividend_duplicate: count(dividends, "duplicate"),
      dividend_unmatched: count(dividends, "unmatched"),
    },
  };
}
