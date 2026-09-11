import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeExposure } from "@/lib/exposure";
import type { ExposureRecord, HoldingRecord, PositionInput } from "@/lib/exposure-types";
import { assetCurrentValue, isOpenPosition, type Asset } from "@/lib/portfolio-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Sincronização de perfis, composição e exposição dos ativos.
 *
 * Fonte de dados: Yahoo Finance quoteSummary (assetProfile, summaryProfile,
 * fundProfile, topHoldings, summaryDetail, price, defaultKeyStatistics).
 * Nunca é utilizado LLM para obter país, setor, indústria, moeda, holdings
 * ou qualquer outro dado financeiro: quando a fonte não devolve o campo,
 * fica `null` e a interface apresenta "Não disponível".
 */

const today = () => new Date().toISOString().slice(0, 10);

/** Cache partilhada de perfis de empresas (país/setor/indústria/moeda). */
const PROFILE_TTL_DAYS = 30;

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

async function loadCompanyProfiles(
  supabase: SB,
  symbols: string[],
): Promise<
  Map<
    string,
    {
      country: string | null;
      sector: string | null;
      industry: string | null;
      currency: string | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      country: string | null;
      sector: string | null;
      industry: string | null;
      currency: string | null;
    }
  >();
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (wanted.length === 0) return out;

  const { data: cached } = await supabase
    .from("security_profiles")
    .select("symbol, country, sector, industry, currency, updated_at")
    .in("symbol", wanted);

  const stale = new Date(Date.now() - PROFILE_TTL_DAYS * 24 * 3600 * 1000).toISOString();
  const fresh = new Set<string>();
  for (const row of (cached ?? []) as Array<{
    symbol: string;
    country: string | null;
    sector: string | null;
    industry: string | null;
    currency: string | null;
    updated_at: string;
  }>) {
    out.set(row.symbol, {
      country: row.country,
      sector: row.sector,
      industry: row.industry,
      currency: row.currency,
    });
    if (row.updated_at > stale) fresh.add(row.symbol);
  }

  const missing = wanted.filter((s) => !fresh.has(s));
  if (missing.length === 0) return out;

  const { fetchQuoteSummary, parseQuoteSummary } = await import("@/lib/exposure.server");
  const upserts: Array<Database["public"]["Tables"]["security_profiles"]["Insert"]> = [];
  // Limite defensivo: evita chamadas externas desnecessárias por sincronização.
  for (const symbol of missing.slice(0, 40)) {
    const qs = await fetchQuoteSummary(symbol);
    if (!qs) continue; // fonte falhou → mantém o que já estava em cache
    const d = parseQuoteSummary(qs);
    const profile = {
      country: d.country,
      sector: d.sector,
      industry: d.industry,
      currency: d.currency,
    };
    out.set(symbol, profile);
    upserts.push({
      symbol,
      name: d.name,
      ...profile,
      source: "yahoo",
      updated_at: new Date().toISOString(),
    });
  }
  if (upserts.length > 0) {
    // security_profiles is a shared reference/cache table. Writes use the
    // trusted server-side client so authenticated users retain read-only access.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("security_profiles")
      .upsert(upserts, { onConflict: "symbol" });
    if (error) console.error("[Exposure] security profile cache update failed:", error.message);
  }
  return out;
}

async function syncOne(supabase: SB, userId: string, asset: Asset): Promise<SyncResult> {
  const base: SyncResult = {
    assetId: asset.id,
    ok: false,
    preserved: true,
    holdings: 0,
    coverage: 0,
  };
  if (!asset.ticker) return { ...base, message: "Ativo sem ticker." };

  const { toYahooSymbol } = await import("@/lib/yahoo.server");
  const symbol = toYahooSymbol(asset.ticker);
  if (!symbol) return { ...base, message: "Ticker inválido." };

  const { fetchQuoteSummary, parseQuoteSummary } = await import("@/lib/exposure.server");
  const qs = await fetchQuoteSummary(symbol);
  // Fonte indisponível: preserva integralmente a última informação válida.
  if (!qs) return { ...base, message: "Fonte indisponível — dados anteriores preservados." };
  const d = parseQuoteSummary(qs);

  const asOf = today();
  const isEtf = asset.class === "etf" || d.quoteType === "ETF" || d.quoteType === "MUTUALFUND";

  // ---- Perfil do ativo (idempotente por asset_id) ----
  const profileRow = {
    user_id: userId,
    asset_id: asset.id,
    official_name: d.name,
    asset_type: d.quoteType,
    currency: d.currency,
    domicile_country: d.country,
    dividend_yield: d.dividendYield,
    category: d.category,
    fund_family: d.family,
    holdings_count: d.holdings.length || null,
    source: "yahoo",
    as_of_date: asOf,
  };
  const { data: existing } = await supabase
    .from("asset_profiles")
    .select("id")
    .eq("asset_id", asset.id)
    .maybeSingle();
  if (existing?.id) await supabase.from("asset_profiles").update(profileRow).eq("id", existing.id);
  else await supabase.from("asset_profiles").insert(profileRow);

  const exposures: Array<Database["public"]["Tables"]["asset_exposures"]["Insert"]> = [];
  const holdingRows: Array<Database["public"]["Tables"]["etf_holdings"]["Insert"]> = [];
  let coverage = 0;

  if (isEtf) {
    const profiles = await loadCompanyProfiles(
      supabase,
      d.holdings.map((h) => h.symbol ?? "").filter(Boolean),
    );
    for (const h of d.holdings) {
      const p = h.symbol ? profiles.get(h.symbol.toUpperCase()) : undefined;
      holdingRows.push({
        user_id: userId,
        asset_id: asset.id,
        holding_name: h.name,
        holding_symbol: h.symbol,
        weight: h.weight,
        country: p?.country ?? null,
        sector: p?.sector ?? null,
        currency: p?.currency ?? null,
        as_of_date: asOf,
        source: "yahoo",
      });
      coverage += h.weight;
    }
    // Exposição setorial publicada pela própria fonte (mais completa que as top holdings).
    for (const s of d.sectorWeights) {
      exposures.push({
        user_id: userId,
        asset_id: asset.id,
        dimension: "sector",
        value: s.sector,
        weight: s.weight,
        source: "yahoo:fundProfile",
        as_of_date: asOf,
      });
    }
  } else {
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
