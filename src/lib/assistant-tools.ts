/**
 * Ferramentas do assistente — SÓ DE LEITURA.
 *
 * Cada ferramenta usa o cliente Supabase do próprio utilizador (RLS aplica-se) e
 * reutiliza o código puro que já alimenta a interface, por isso os números do
 * assistente coincidem com os do dashboard. Nenhuma ferramenta escreve na base
 * de dados e nenhuma obtém dados financeiros por IA.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/external-types";
import {
  allocationByClass,
  assetPerformance,
  portfolioSummary,
  type TimelineTransaction,
} from "@/lib/dashboard";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { buildOpenLots } from "@/lib/fifo";
import type { DividendRecord } from "@/lib/dividends";
import { CLASS_LABELS, isOpenPosition, type Asset } from "@/lib/portfolio-types";
import { buybackDiscountOf, summarizeMetal } from "@/lib/metals";
import { loadPosition } from "@/lib/portfolio.functions";
import { loadExposure } from "@/lib/exposure.functions";
import { loadDividendCalendar } from "@/lib/insights.functions";
import {
  dividendReport,
  norm,
  realizedReport,
  roundDeep,
  snapshotReport,
  type AssistantDividendRow,
} from "@/lib/assistant-data";

export type AssistantSupabase = SupabaseClient<Database>;

export interface AssistantTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  execute: (sb: AssistantSupabase, raw: unknown) => Promise<unknown>;
}

function defineTool<T extends z.ZodTypeAny>(def: {
  name: string;
  description: string;
  properties?: Record<string, unknown>;
  schema: T;
  run: (sb: AssistantSupabase, input: z.infer<T>) => Promise<unknown>;
}): AssistantTool {
  return {
    name: def.name,
    description: def.description,
    input_schema: { type: "object", properties: def.properties ?? {} },
    execute: (sb, raw) => def.run(sb, def.schema.parse(raw ?? {})),
  };
}

const ASSET_CLASSES = [
  "etf",
  "acao_crescimento",
  "reit",
  "acao_dividendo",
  "metal",
  "p2p",
] as const;

async function loadAssets(sb: AssistantSupabase): Promise<Asset[]> {
  const { data, error } = await sb.from("assets").select("*").order("created_at");
  if (error) throw dbError(error);
  return (data ?? []) as unknown as Asset[];
}

async function loadDividends(sb: AssistantSupabase): Promise<AssistantDividendRow[]> {
  const { data, error } = await sb.from("dividends").select("*");
  if (error) throw dbError(error);
  return (data ?? []) as unknown as AssistantDividendRow[];
}

const portfolioSummaryTool = defineTool({
  name: "portfolio_summary",
  description:
    "Resumo da carteira: valor atual, custo, mais/menos-valias realizadas e latentes, dividendos recebidos e por receber, rentabilidade total, yield, número de posições e peso de cada classe de ativo.",
  schema: z.object({}),
  run: async (sb) => {
    const [assets, dividends, txRes] = await Promise.all([
      loadAssets(sb),
      loadDividends(sb),
      sb.from("transactions").select("type, traded_at, quantity, price, fee, realized_pl"),
    ]);
    if (txRes.error) throw dbError(txRes.error);
    const txs = (txRes.data ?? []) as unknown as TimelineTransaction[];
    return roundDeep({
      today: todayLisbon(),
      summary: portfolioSummary(assets, dividends as DividendRecord[], todayLisbon(), txs),
      allocation: allocationByClass(assets).map((s) => ({
        class: s.label,
        value: s.value,
        pct: s.pct,
        positions: s.count,
      })),
    });
  },
});

const listPositionsTool = defineTool({
  name: "list_positions",
  description:
    "Lista de posições (ativos) com quantidade, valor atual, custo, ganho/perda e peso na carteira. Permite filtrar por classe, por estado e por nome/ticker.",
  properties: {
    class: {
      type: "string",
      enum: [...ASSET_CLASSES],
      description: "etf, acao_crescimento, reit, acao_dividendo, metal ou p2p",
    },
    status: { type: "string", enum: ["open", "closed"], description: "Por omissão: open" },
    search: { type: "string", description: "Parte do nome ou do ticker" },
    limit: { type: "integer", description: "Máximo de linhas (por omissão 30, máximo 60)" },
  },
  schema: z.object({
    class: z.enum(ASSET_CLASSES).optional(),
    status: z.enum(["open", "closed"]).default("open"),
    search: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(60).default(30),
  }),
  run: async (sb, input) => {
    const assets = await loadAssets(sb);
    const match = (a: Asset) =>
      (!input.class || a.class === input.class) &&
      (!input.search || norm(`${a.name} ${a.ticker ?? ""}`).includes(norm(input.search)));
    if (input.status === "closed") {
      const rows = assets
        .filter((a) => !isOpenPosition(a) && match(a))
        .slice(0, input.limit)
        .map((a) => ({
          name: a.name,
          ticker: a.ticker,
          class: CLASS_LABELS[a.class],
          realizedPL: a.realized_pl,
          closedAt: a.closed_at,
        }));
      return roundDeep({ status: "closed", rows });
    }
    const perf = assetPerformance(assets).filter((p) => {
      const a = assets.find((x) => x.id === p.id);
      return a ? match(a) : false;
    });
    const rows = perf.slice(0, input.limit).map((p) => {
      const a = assets.find((x) => x.id === p.id)!;
      return {
        name: p.name,
        ticker: p.ticker,
        class: CLASS_LABELS[p.class],
        quantity: a.quantity,
        value: p.value,
        invested: p.invested,
        unrealized: p.unrealized,
        unrealizedPct: p.unrealizedPct,
        weightPct: p.weight,
        annualYieldPct: a.annual_yield,
      };
    });
    return roundDeep({ status: "open", total: perf.length, shown: rows.length, rows });
  },
});

const dividendsTool = defineTool({
  name: "dividends",
  description:
    "Dividendos recebidos (líquido, bruto e imposto) e por receber, por ativo e por mês, opcionalmente para um ano e/ou um ativo. Indica quantos eventos recebidos têm data de pagamento ainda estimada.",
  properties: {
    year: { type: "integer", description: "Ano de pagamento, ex.: 2026" },
    asset: { type: "string", description: "Parte do nome do ativo" },
  },
  schema: z.object({
    year: z.number().int().min(2000).max(2100).optional(),
    asset: z.string().max(80).optional(),
  }),
  run: async (sb, input) =>
    dividendReport(await loadDividends(sb), {
      year: input.year ?? null,
      asset: input.asset ?? null,
      today: todayLisbon(),
    }),
});

const realizedGainsTool = defineTool({
  name: "realized_gains",
  description:
    "Mais/menos-valias realizadas pelas vendas (FIFO da app), por ano e por ativo. Não é o apuramento fiscal de IRS.",
  properties: { year: { type: "integer", description: "Ano da venda, ex.: 2026" } },
  schema: z.object({ year: z.number().int().min(2000).max(2100).optional() }),
  run: async (sb, input) => {
    const [assets, txRes] = await Promise.all([
      loadAssets(sb),
      sb.from("transactions").select("type, traded_at, realized_pl, asset_id").eq("type", "sell"),
    ]);
    if (txRes.error) throw dbError(txRes.error);
    return realizedReport(
      txRes.data ?? [],
      new Map(assets.map((a) => [a.id, a.name] as const)),
      input.year ?? null,
    );
  },
});

const EXPOSURE_DIMENSIONS = [
  "class",
  "country",
  "region",
  "continent",
  "development",
  "sector",
  "industry",
  "currency",
  "companies",
] as const;

const exposureTool = defineTool({
  name: "exposure",
  description:
    "Exposição económica da carteira (com look-through dos ETFs) por classe, país, região, continente, mercado desenvolvido/emergente, setor, indústria, moeda ou empresa. Inclui concentração e cobertura dos dados.",
  properties: {
    dimension: { type: "string", enum: [...EXPOSURE_DIMENSIONS] },
    limit: { type: "integer", description: "Máximo de linhas (por omissão 12, máximo 40)" },
  },
  schema: z.object({
    dimension: z.enum(EXPOSURE_DIMENSIONS),
    limit: z.number().int().min(1).max(40).default(12),
  }),
  run: async (sb, input) => {
    const { report } = await loadExposure(sb);
    const base = {
      totalValue: report.total,
      coveragePct: report.coverage,
      concentration: report.concentration,
    };
    if (input.dimension === "companies") {
      return roundDeep({
        dimension: "companies",
        ...base,
        rows: report.companies.slice(0, input.limit).map((c) => ({
          name: c.name,
          amount: c.amount,
          pct: c.pct,
          directAmount: c.direct,
          viaEtfsAmount: c.indirect,
          country: c.country,
          sector: c.sector,
        })),
      });
    }
    const slices = {
      class: report.byClass,
      country: report.country,
      region: report.region,
      continent: report.continent,
      development: report.development,
      sector: report.sector,
      industry: report.industry,
      currency: report.currency,
    }[input.dimension];
    return roundDeep({
      dimension: input.dimension,
      ...base,
      rows: slices.slice(0, input.limit).map((s) => ({
        value: s.value,
        amount: s.amount,
        pct: s.pct,
        mainContributors: s.contributors.slice(0, 3).map((c) => c.name),
      })),
    });
  },
});

const metalsTool = defineTool({
  name: "metals_summary",
  description:
    "Metais preciosos em custódia (ouro/prata): gramas detidas, total pago, ágio pago, taxas de armazenamento (em gramas e em euros), custo médio por grama, spot, preço de recompra, valor ao spot e à recompra, ganho/perda e a sua decomposição.",
  schema: z.object({}),
  run: async (sb) => {
    const metals = (await loadAssets(sb)).filter((a) => a.class === "metal" && isOpenPosition(a));
    const rows = [];
    for (const m of metals) {
      const { asset, txs, entries, inKindFees } = await loadPosition(sb, m.id);
      const s = summarizeMetal({
        buys: txs
          .filter((t) => t.type === "buy")
          .map((t) => ({
            id: t.id,
            traded_at: t.traded_at,
            quantity: Number(t.quantity),
            price: Number(t.price),
            fee: Number(t.fee ?? 0),
            premium_rate: t.premium_rate == null ? null : Number(t.premium_rate),
          })),
        storage: inKindFees,
        lots: buildOpenLots(entries),
        hasSales: txs.some((t) => t.type === "sell"),
        currentPrice: Number(asset.current_price ?? 0),
        discount: buybackDiscountOf(asset.buyback_discount),
      });
      rows.push({
        name: asset.name,
        metal: asset.metal_type,
        custodian: asset.custodian,
        gramsBought: s.gramsBought,
        gramsDeductedByStorage: s.gramsDeducted,
        gramsHeld: s.gramsHeld,
        paidTotalEUR: s.invested,
        premiumPaidEUR: s.premiumPaid,
        storageBilledEUR: s.storageBilled,
        avgCostPerGramEUR: s.avgCostPerGram,
        spotPerGramEUR: s.spot,
        buybackPerGramEUR: s.buyback,
        buybackDiscountPct: s.discount * 100,
        valueAtSpotEUR: s.valueAtSpot,
        valueAtBuybackEUR: s.valueAtBuyback,
        unrealizedPLEUR: s.unrealizedPL,
        unrealizedPct: s.unrealizedPct * 100,
        plBreakdownEUR: s.breakdown,
        purchases: s.lots.length,
      });
    }
    return roundDeep({ count: rows.length, rows });
  },
});

const snapshotsTool = defineTool({
  name: "snapshots",
  description:
    "Evolução histórica do valor de mercado e do capital investido (fotografias diárias da carteira), com variação entre o primeiro e o último ponto do período.",
  properties: {
    scope: {
      type: "string",
      description: "'total' (por omissão) ou 'class:<classe>', ex.: class:etf, class:metal",
    },
    from: { type: "string", description: "Data inicial AAAA-MM-DD" },
    to: { type: "string", description: "Data final AAAA-MM-DD" },
  },
  schema: z.object({
    scope: z
      .string()
      .regex(/^(total|class:[a-z_]+)$/)
      .default("total"),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  run: async (sb, input) => {
    let q = sb
      .from("portfolio_snapshots")
      .select("snapshot_date, market_value, invested_amount")
      .eq("scope", input.scope)
      .order("snapshot_date", { ascending: true })
      .limit(1000);
    if (input.from) q = q.gte("snapshot_date", input.from);
    if (input.to) q = q.lte("snapshot_date", input.to);
    const { data, error } = await q;
    if (error) throw dbError(error);
    return snapshotReport(
      (data ?? []).map((r) => ({
        snapshot_date: r.snapshot_date,
        market_value: r.market_value == null ? null : Number(r.market_value),
        invested_amount: Number(r.invested_amount) || 0,
      })),
      input.scope,
    );
  },
});

const dividendCalendarTool = defineTool({
  name: "dividend_calendar",
  description:
    "Projeção (estimativa) dos dividendos dos próximos meses, por mês e os próximos pagamentos, a partir do histórico de cada ativo.",
  properties: {
    months: { type: "integer", description: "Horizonte em meses (por omissão 12, máximo 24)" },
  },
  schema: z.object({ months: z.number().int().min(1).max(24).default(12) }),
  run: async (sb, input) => {
    const cal = await loadDividendCalendar(sb, input.months);
    return roundDeep({
      note: "Estimativa baseada no histórico; não é um valor garantido.",
      months: input.months,
      totalNet: cal.totalNet,
      totalGross: cal.totalGross,
      byMonth: cal.byMonth,
      nextPayments: cal.events.slice(0, 15).map((e) => ({
        asset: e.assetName,
        exDate: e.exDate,
        paymentDate: e.paymentDate,
        net: e.net,
        gross: e.gross,
      })),
      assetsWithoutProjection: cal.skipped.map((s) => ({ asset: s.assetName, reason: s.reason })),
    });
  },
});

export const assistantTools: AssistantTool[] = [
  portfolioSummaryTool,
  listPositionsTool,
  dividendsTool,
  realizedGainsTool,
  exposureTool,
  metalsTool,
  snapshotsTool,
  dividendCalendarTool,
];
