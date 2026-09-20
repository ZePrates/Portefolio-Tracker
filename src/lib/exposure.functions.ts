import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { computeExposure } from "@/lib/exposure";
import type { ExposureRecord, HoldingRecord, PositionInput } from "@/lib/exposure-types";
import { assetCurrentValue, isOpenPosition, type Asset } from "@/lib/portfolio-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Sincronização de perfis, composição e exposição dos ativos.
 *
 * ETFs usam exclusivamente o JustETF, identificado pelo ISIN. Os restantes
 * títulos usam Yahoo Finance quoteSummary para o respetivo perfil.
 * Nunca é utilizado LLM para obter país, setor, indústria, moeda, holdings
 * ou qualquer outro dado financeiro: quando a fonte não devolve o campo,
 * fica `null` e a interface apresenta "Não disponível".
 */

const today = () => new Date().toISOString().slice(0, 10);

type SB = { from: SupabaseClient<Database>["from"] };

interface SyncResult {
  assetId: string;
  ok: boolean;
  /** true quando a fonte falhou e os dados anteriores foram preservados. */
  preserved: boolean;
  holdings: number;
  /** Soma dos pesos das holdings conhecidas (0–1). */
  coverage: number;
  message?: string;
}

async function syncOne(supabase: SB, userId: string, asset: Asset): Promise<SyncResult> {
  const base: SyncResult = {
    assetId: asset.id,
    ok: false,
    preserved: true,
    holdings: 0,
    coverage: 0,
  };
  // Estado já guardado para nunca apagar dados válidos numa falha da fonte.
  const { data: existing } = await supabase
    .from("asset_profiles")
    .select("id, isin, official_name, fund_family, manager_slug, provider_ref")
    .eq("asset_id", asset.id)
    .maybeSingle();

  const isin = asset.isin ?? existing?.isin ?? null;
  const isEtf = asset.class === "etf";
  let justEtf: Awaited<
    ReturnType<typeof import("@/lib/exposure-providers/justetf.server").fetchJustEtf>
  > = null;
  let d: ReturnType<typeof import("@/lib/exposure.server").parseQuoteSummary> | null = null;

  // Segunda opção para ETFs: TradingView (apenas identidade — o scanner não
  // publica pesos de país/setor nem holdings). Preenche a ficha quando o
  // JustETF falha ou vem parcial; a exposição nunca é inventada.
  let tradingView: Awaited<
    ReturnType<typeof import("@/lib/exposure-providers/tradingview.server").fetchTradingViewEtf>
  > = null;
  let etfPartial = false;

  if (isEtf) {
    if (!isin) return { ...base, message: "ETF sem ISIN para consulta no JustETF." };
    const { fetchJustEtf } = await import("@/lib/exposure-providers/justetf.server");
    justEtf = await fetchJustEtf(isin);
    etfPartial =
      !justEtf ||
      justEtf.holdings.length === 0 ||
      !justEtf.countryWeights ||
      !justEtf.sectorWeights;
    if (etfPartial) {
      const { fetchTradingViewEtf } = await import(
        "@/lib/exposure-providers/tradingview.server"
      );
      tradingView = await fetchTradingViewEtf(isin);
    }
    if (!justEtf && !tradingView)
      return { ...base, message: "JustETF indisponível — dados anteriores preservados." };
  } else {
    if (!asset.ticker) return { ...base, message: "Ativo sem ticker." };
    const { toYahooSymbol } = await import("@/lib/yahoo.server");
    const symbol = toYahooSymbol(asset.ticker);
    const { fetchQuoteSummary, parseQuoteSummary } = await import("@/lib/exposure.server");
    const qs = symbol ? await fetchQuoteSummary(symbol) : null;
    d = qs ? parseQuoteSummary(qs) : null;
    if (!d) return { ...base, message: "Fonte indisponível — dados anteriores preservados." };
  }

  const asOf = justEtf?.asOfDate ?? today();

  // ---- Perfil do ativo (idempotente por asset_id) — nunca apaga um valor
  // bom anterior só porque esta sincronização não o obteve de novo. ----
  const profileRow = {
    user_id: userId,
    asset_id: asset.id,
    official_name:
      justEtf?.officialName ??
      tradingView?.officialName ??
      d?.name ??
      existing?.official_name ??
      null,
    asset_type: d?.quoteType ?? (isEtf ? "ETF" : null),
    currency: d?.currency ?? tradingView?.currency ?? null,
    domicile_country: d?.country ?? tradingView?.domicile ?? null,
    dividend_yield: d?.dividendYield ?? null,
    category: d?.category ?? null,
    fund_family: isEtf ? null : (d?.family ?? existing?.fund_family ?? null),
    isin,
    manager_slug: isEtf ? null : (existing?.manager_slug ?? null),
    provider_ref: (isEtf
      ? null
      : (existing?.provider_ref ??
        null)) as Database["public"]["Tables"]["asset_profiles"]["Row"]["provider_ref"],
    holdings_count: (justEtf?.holdings.length ?? d?.holdings.length ?? 0) || null,
    source: isEtf ? "justetf" : "yahoo",
    as_of_date: asOf,
  };
  if (existing?.id) await supabase.from("asset_profiles").update(profileRow).eq("id", existing.id);
  else await supabase.from("asset_profiles").insert(profileRow);

  const exposures: Array<Database["public"]["Tables"]["asset_exposures"]["Insert"]> = [];
  const holdingRows: Array<Database["public"]["Tables"]["etf_holdings"]["Insert"]> = [];
  let coverage = 0;

  if (isEtf && justEtf) {
    const source = "justetf";
    for (const h of justEtf.holdings) {
      holdingRows.push({
        user_id: userId,
        asset_id: asset.id,
        holding_name: h.name,
        holding_symbol: h.symbol,
        isin: h.isin,
        weight: h.weight,
        country: h.country,
        sector: h.sector,
        currency: h.currency,
        as_of_date: asOf,
        source,
      });
      coverage += h.weight;
    }
    const sectorWeights = justEtf.sectorWeights ?? [];
    for (const s of sectorWeights) {
      exposures.push({
        user_id: userId,
        asset_id: asset.id,
        dimension: "sector",
        value: s.sector,
        weight: s.weight,
        source: `${source}:fund`,
        as_of_date: asOf,
      });
    }
    const countryWeights = justEtf.countryWeights ?? [];
    for (const c of countryWeights) {
      exposures.push({
        user_id: userId,
        asset_id: asset.id,
        dimension: "country",
        value: c.country,
        weight: c.weight,
        source: `${source}:fund`,
        as_of_date: asOf,
      });
    }
  } else if (d) {
    if (d.country)
      exposures.push({
        user_id: userId,
        asset_id: asset.id,
        dimension: "country",
        value: d.country,
        weight: 1,
        source: "yahoo:assetProfile",
        as_of_date: asOf,
      });
    if (d.sector)
      exposures.push({
        user_id: userId,
        asset_id: asset.id,
        dimension: "sector",
        value: d.sector,
        weight: 1,
        source: "yahoo:assetProfile",
        as_of_date: asOf,
      });
    if (d.industry)
      exposures.push({
        user_id: userId,
        asset_id: asset.id,
        dimension: "industry",
        value: d.industry,
        weight: 1,
        source: "yahoo:assetProfile",
        as_of_date: asOf,
      });
    coverage = d.country ? 1 : 0;
  }

  // Substituição atómica por ativo: apaga e reinsere apenas quando há dados novos válidos.
  if (exposures.length > 0) {
    await supabase.from("asset_exposures").delete().eq("asset_id", asset.id);
    await supabase.from("asset_exposures").insert(exposures);
  }
  if (holdingRows.length > 0) {
    await supabase.from("etf_holdings").delete().eq("asset_id", asset.id);
    await supabase.from("etf_holdings").insert(holdingRows);
  }

  return {
    assetId: asset.id,
    ok: exposures.length > 0 || holdingRows.length > 0,
    preserved: exposures.length === 0 && holdingRows.length === 0,
    holdings: holdingRows.length,
    coverage: Math.min(1, coverage),
    ...(exposures.length === 0 && holdingRows.length === 0
      ? { message: "A fonte não publica composição para este ativo." }
      : {}),
  };
}

export const syncAssetExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ assetId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: asset, error } = await context.supabase
      .from("assets")
      .select("*")
      .eq("id", data.assetId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!asset) throw new Error("Ativo não encontrado.");
    return syncOne(context.supabase as unknown as SB, context.userId, asset as Asset);
  });

export const syncAllAssetExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("assets")
      .select("*")
      .neq("status", "closed");
    if (error) throw new Error(error.message);

    const targets = ((rows ?? []) as Asset[]).filter(
      (a) => a.ticker && a.class !== "metal" && a.class !== "p2p" && isOpenPosition(a),
    );
    const results: SyncResult[] = [];
    for (const a of targets) {
      try {
        results.push(await syncOne(context.supabase as unknown as SB, context.userId, a));
      } catch (e) {
        results.push({
          assetId: a.id,
          ok: false,
          preserved: true,
          holdings: 0,
          coverage: 0,
          message: e instanceof Error ? e.message : "Erro desconhecido.",
        });
      }
    }
    return {
      total: targets.length,
      updated: results.filter((r) => r.ok).length,
      preserved: results.filter((r) => r.preserved).length,
      results,
    };
  });

export interface AssetExposureMeta {
  assetId: string;
  name: string;
  class: string;
  ticker: string | null;
  /** Valor atual da posição na carteira (EUR). */
  value: number;
  /** Cobertura da composição conhecida (0–100). */
  coverage: number;
  /** true quando a geografia/setor foram derivados das holdings. */
  derived: boolean;
  asOfDate: string | null;
  source: string | null;
  domicile: string | null;
}

/** Leitura consolidada: lê exclusivamente da base de dados (sem chamadas externas). */
export const getExposure = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [assetsRes, exposuresRes, holdingsRes, profilesRes] = await Promise.all([
      context.supabase.from("assets").select("*").neq("status", "closed"),
      context.supabase.from("asset_exposures").select("*"),
      context.supabase.from("etf_holdings").select("*"),
      context.supabase.from("asset_profiles").select("*"),
    ]);
    if (assetsRes.error) throw new Error(assetsRes.error.message);

    const assets = ((assetsRes.data ?? []) as Asset[]).filter(isOpenPosition);
    const exposures = (exposuresRes.data ?? []) as Array<{
      asset_id: string;
      dimension: string;
      value: string;
      weight: number;
      source: string | null;
      as_of_date: string | null;
    }>;
    const holdings = (holdingsRes.data ?? []) as Array<{
      asset_id: string;
      holding_name: string;
      holding_symbol: string | null;
      weight: number;
      country: string | null;
      sector: string | null;
      currency: string | null;
      as_of_date: string | null;
      source: string | null;
    }>;
    const profiles = (profilesRes.data ?? []) as Array<{
      asset_id: string;
      domicile_country: string | null;
      source: string | null;
      as_of_date: string | null;
    }>;

    const positions: PositionInput[] = [];
    const meta: AssetExposureMeta[] = [];

    for (const a of assets) {
      const ex = exposures.filter((e) => e.asset_id === a.id);
      const hs = holdings.filter((h) => h.asset_id === a.id);
      const profile = profiles.find((p) => p.asset_id === a.id) ?? null;

      positions.push({
        assetId: a.id,
        name: a.name,
        class: a.class,
        ticker: a.ticker,
        value: assetCurrentValue(a),
        nativeCurrency: a.native_currency || a.currency || "EUR",
        exposures: ex.map((e): ExposureRecord => ({
          dimension: e.dimension as ExposureRecord["dimension"],
          value: e.value,
          weight: Number(e.weight) || 0,
          source: e.source,
          as_of_date: e.as_of_date,
        })),
        holdings: hs.map((h): HoldingRecord => ({
          name: h.holding_name,
          symbol: h.holding_symbol,
          weight: Number(h.weight) || 0,
          country: h.country,
          sector: h.sector,
          currency: h.currency,
          as_of_date: h.as_of_date,
        })),
      });

      const holdingCoverage = hs.reduce((s, h) => s + (Number(h.weight) || 0), 0);
      const hasCountryDim = ex.some((e) => e.dimension === "country");
      meta.push({
        assetId: a.id,
        name: a.name,
        class: a.class,
        ticker: a.ticker,
        value: assetCurrentValue(a),
        coverage: Math.min(100, (hasCountryDim ? 1 : holdingCoverage) * 100),
        derived: !hasCountryDim && hs.length > 0,
        asOfDate: hs[0]?.as_of_date ?? ex[0]?.as_of_date ?? profile?.as_of_date ?? null,
        source: hs[0]?.source ?? ex[0]?.source ?? profile?.source ?? null,
        domicile: profile?.domicile_country ?? null,
      });
    }

    return { report: computeExposure(positions), meta };
  });

export interface AssetExposureDetail {
  assetId: string;
  value: number;
  coverage: number;
  asOfDate: string | null;
  source: string | null;
  profile: {
    officialName: string | null;
    assetType: string | null;
    currency: string | null;
    domicile: string | null;
    category: string | null;
    family: string | null;
    dividendYield: number | null;
    holdingsCount: number | null;
    isin: string | null;
    managerSlug: string | null;
  } | null;
  /** Dimensões declaradas pela fonte para este ativo. */
  dimensions: Array<{ dimension: string; value: string; pct: number }>;
  /** Composição (holdings) com o valor económico correspondente. */
  holdings: Array<{
    name: string;
    symbol: string | null;
    pct: number;
    amount: number;
    country: string | null;
    sector: string | null;
    currency: string | null;
  }>;
  /** Datas distintas de composição já registadas (histórico por as_of_date). */
  history: string[];
}

/** Exposição subjacente de um único ativo — lê da mesma fonte persistida. */
export const getAssetExposure = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ assetId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<AssetExposureDetail> => {
    const [assetRes, exRes, hsRes, prRes] = await Promise.all([
      context.supabase.from("assets").select("*").eq("id", data.assetId).maybeSingle(),
      context.supabase.from("asset_exposures").select("*").eq("asset_id", data.assetId),
      context.supabase.from("etf_holdings").select("*").eq("asset_id", data.assetId),
      context.supabase
        .from("asset_profiles")
        .select("*")
        .eq("asset_id", data.assetId)
        .maybeSingle(),
    ]);
    if (assetRes.error) throw new Error(assetRes.error.message);
    if (!assetRes.data) throw new Error("Ativo não encontrado.");

    const asset = assetRes.data as Asset;
    const value = assetCurrentValue(asset);
    const ex = (exRes.data ?? []) as Array<{
      dimension: string;
      value: string;
      weight: number;
      source: string | null;
      as_of_date: string | null;
    }>;
    const hs = (hsRes.data ?? []) as Array<{
      holding_name: string;
      holding_symbol: string | null;
      weight: number;
      country: string | null;
      sector: string | null;
      currency: string | null;
      as_of_date: string | null;
      source: string | null;
    }>;
    const pr = (prRes.data ?? null) as {
      official_name: string | null;
      asset_type: string | null;
      currency: string | null;
      domicile_country: string | null;
      category: string | null;
      fund_family: string | null;
      dividend_yield: number | null;
      holdings_count: number | null;
      source: string | null;
      as_of_date: string | null;
      isin: string | null;
      manager_slug: string | null;
    } | null;

    const holdingCoverage = hs.reduce((s, h) => s + (Number(h.weight) || 0), 0);
    const hasCountryDim = ex.some((e) => e.dimension === "country");

    return {
      assetId: asset.id,
      value,
      coverage: Math.min(100, (hasCountryDim ? 1 : holdingCoverage) * 100),
      asOfDate: hs[0]?.as_of_date ?? ex[0]?.as_of_date ?? pr?.as_of_date ?? null,
      source: hs[0]?.source ?? ex[0]?.source ?? pr?.source ?? null,
      profile: pr
        ? {
            officialName: pr.official_name,
            assetType: pr.asset_type,
            currency: pr.currency,
            domicile: pr.domicile_country,
            category: pr.category,
            family: pr.fund_family,
            dividendYield: pr.dividend_yield,
            holdingsCount: pr.holdings_count,
            isin: pr.isin,
            managerSlug: pr.manager_slug,
          }
        : null,
      dimensions: ex
        .map((e) => ({
          dimension: e.dimension,
          value: e.value,
          pct: (Number(e.weight) || 0) * 100,
        }))
        .sort((a, b) => a.dimension.localeCompare(b.dimension) || b.pct - a.pct),
      holdings: hs
        .map((h) => ({
          name: h.holding_name,
          symbol: h.holding_symbol,
          pct: (Number(h.weight) || 0) * 100,
          amount: value * (Number(h.weight) || 0),
          country: h.country,
          sector: h.sector,
          currency: h.currency,
        }))
        .sort((a, b) => b.pct - a.pct),
      history: [...new Set(hs.map((h) => h.as_of_date).filter((d): d is string => !!d))]
        .sort()
        .reverse(),
    };
  });
