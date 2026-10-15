import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// Sincroniza holdings completas dos ETFs a partir das fontes oficiais das gestoras.
// iShares (CSV), Vanguard (GraphQL oficial), Xtrackers/DWS (Excel), Global X (CSV), VanEck (Excel).
// Corre sempre com a sessão do utilizador (RLS ativo). Evita downloads quando os dados não mudaram.
// Publicada no projeto Supabase externo (azekwmamjovoguauncrg) com verify_jwt = true.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Row = { name: string; symbol?: string | null; isin?: string | null; weight: number; sector?: string | null; country?: string | null; currency?: string | null; asset_class?: string | null; exchange?: string | null; mv?: number | null };
type Result = Record<string, unknown>;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRY_FIX: Record<string, string> = { HK: "Hong Kong", KR: "South Korea", TW: "Taiwan", CZ: "Czech Republic", TR: "Turkey", RU: "Russia", MO: "Macau" };
function countryName(code?: string | null): string | null {
  if (!code || code.length !== 2 || code === "XE") return null;
  if (COUNTRY_FIX[code]) return COUNTRY_FIX[code];
  try { return regionNames.of(code) ?? null; } catch { return null; }
}

const MANAGERS = ["ishares", "vanguard", "xtrackers", "globalx", "vaneck"];
function detectManager(name: string, slug?: string | null): string | null {
  if (slug && MANAGERS.includes(slug)) return slug;
  if (/^ishares/i.test(name)) return "ishares";
  if (/^vanguard/i.test(name)) return "vanguard";
  if (/^xtrackers/i.test(name)) return "xtrackers";
  if (/^global x/i.test(name)) return "globalx";
  if (/^vaneck/i.test(name)) return "vaneck";
  return null;
}

/** Divide uma linha CSV respeitando campos entre aspas (com "" escapado). */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Quando a gestora não dá o setor de cada posição, o import recalcularia a
 * exposição por setor como 100 % "Other". Nesse caso repõe-se a repartição por
 * setor que já existia ao nível do fundo (ex.: FT), para não perder informação.
 */
async function withFundSectorsKept(sb: SupabaseClient, assetId: string, rows: Row[], run: () => Promise<Result>): Promise<Result> {
  const hasSectors = rows.some((r) => r.sector);
  const { data: before } = hasSectors
    ? { data: null }
    : await sb.from("asset_exposures").select("user_id, asset_id, dimension, value, weight, source, as_of_date").eq("asset_id", assetId).eq("dimension", "sector");
  const result = await run();
  if (!hasSectors && result?.ok && before && before.length > 0) {
    await sb.from("asset_exposures").delete().eq("asset_id", assetId).eq("dimension", "sector");
    await sb.from("asset_exposures").insert(before);
    return { ...result, sectors_kept: before.length };
  }
  return result;
}

// ---------- iShares ----------
const ISH = "https://www.ishares.com";
async function isharesSync(sb: SupabaseClient, assetId: string, isin: string | null, ref: Record<string, unknown>): Promise<Result> {
  let pid = (ref.ishares_portfolio_id as string) ?? null;
  if (!pid && isin) {
    const r = await fetch(`${ISH}/varnish-api/core-search/search/products?site=ishares-uk&locale=en-gb&rows=5&start=0&userType=individual&query=${encodeURIComponent(isin)}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.ok) pid = (await r.json())?.results?.[0]?.portfolioId ?? null;
  }
  if (!pid) throw new Error("Produto iShares não encontrado pelo ISIN");
  const r = await fetch(`${ISH}/uk/individual/en/products/${pid}/fund/latest-holdings.csv`, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" } });
  const csv = await r.text();
  if (!r.ok || !csv.startsWith("Fund Holdings as of")) throw new Error(`CSV iShares indisponível (HTTP ${r.status})`);
  const { data, error } = await sb.rpc("import_ishares_holdings", { p_asset_id: assetId, p_csv: csv, p_portfolio_id: pid });
  if (error) throw new Error(error.message);
  return data as Result;
}

// ---------- Vanguard ----------
const VG = "https://www.nl.vanguard/gpx/graphql";
const VG_HEADERS = { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json", "x-consumer-id": "nl0", Origin: "https://www.nl.vanguard" };
// O esquema da Vanguard não aceita variáveis do tipo Int: o limite vai no texto da consulta.
const vgQuery = (limit: number) => `query FundsHoldingsQuery($portIds: [String!], $lastItemKey: String) { borHoldings(portIds: $portIds) { holdings(limit: ${limit}, lastItemKey: $lastItemKey) { totalHoldings lastItemKey items { issuerName securityLongDescription gicsSectorDescription marketValuePercentage ticker isin bloombergIsoCountry } } } }`;
async function vgPage(portId: string, lastItemKey: string | null, limit: number) {
  const r = await fetch(VG, { method: "POST", headers: VG_HEADERS, body: JSON.stringify({ operationName: "FundsHoldingsQuery", variables: { portIds: [portId], lastItemKey }, query: vgQuery(limit) }) });
  const d = await r.json();
  if (!r.ok || d.errors) throw new Error(`Vanguard: ${JSON.stringify(d.errors ?? r.status).slice(0, 200)}`);
  return d?.data?.borHoldings?.[0]?.holdings as { totalHoldings: number; lastItemKey: string | null; items: any[] };
}
const vgDate = (key: string | null) => key?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

async function vanguardSync(sb: SupabaseClient, assetId: string, ref: Record<string, unknown>, storedAsOf: string | null, force: boolean): Promise<Result> {
  const portId = ref.vanguard_port_id as string | undefined;
  if (!portId) throw new Error("Falta o código Vanguard (vanguard_port_id) no perfil do ETF");
  // Consulta mínima (2 linhas) só para saber a data dos dados; evita descarregar milhares de linhas sem necessidade.
  const probe = await vgPage(portId, null, 2);
  const asOf = vgDate(probe.lastItemKey);
  if (!force && asOf && storedAsOf === asOf) {
    await sb.from("asset_profiles").update({ holdings_error: null, holdings_synced_at: new Date().toISOString() }).eq("asset_id", assetId);
    return { ok: true, unchanged: true, as_of: asOf };
  }
  const items: any[] = [];
  let key: string | null = null;
  for (let i = 0; i < 10; i++) {
    const page = await vgPage(portId, key, 1500);
    items.push(...(page.items ?? []));
    key = page.lastItemKey;
    if (!key) break;
  }
  const rows: Row[] = items.map((x) => ({
    name: x.issuerName || x.securityLongDescription,
    symbol: x.ticker || null,
    isin: x.isin || null,
    weight: Number(x.marketValuePercentage) / 100,
    sector: x.gicsSectorDescription || null,
    country: countryName(x.bloombergIsoCountry),
    asset_class: x.isin ? "Equity" : "Cash and/or Derivatives",
  }));
  const { data, error } = await sb.rpc("import_etf_holdings", { p_asset_id: assetId, p_source: "vanguard", p_as_of: asOf ?? new Date().toISOString().slice(0, 10), p_rows: rows, p_provider_ref: { vanguard_port_id: portId } });
  if (error) throw new Error(error.message);
  return data as Result;
}

// ---------- Xtrackers (DWS) ----------
async function xtrackersSync(sb: SupabaseClient, assetId: string, isin: string | null): Promise<Result> {
  if (!isin) throw new Error("Falta o ISIN");
  const r = await fetch(`https://etf.dws.com/etfdata/export/GBR/ENG/excel/product/constituent/${isin}/`, { headers: { "User-Agent": UA, Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*" } });
  const ct = r.headers.get("content-type") ?? "";
  if (!r.ok || ct.includes("text/html")) throw new Error(`DWS bloqueou o download (HTTP ${r.status})`);
  const XLSX = await import("npm:xlsx@0.18.5");
  const wb = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const hIdx = grid.findIndex((row) => row.some((c) => /^name$/i.test(String(c ?? "").trim())) && row.some((c) => /weight/i.test(String(c ?? ""))));
  if (hIdx < 0) throw new Error("Formato do Excel DWS não reconhecido");
  const head = grid[hIdx].map((c) => String(c ?? "").trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const cName = col(/^name$/), cIsin = col(/isin/), cW = col(/weight/), cCountry = col(/country/), cCur = col(/currency/), cSector = col(/industry|sector/), cType = col(/type/), cExch = col(/exchange/);
  const dateText = grid.slice(0, hIdx).flat().map((c) => String(c ?? "")).join(" ");
  const dm = dateText.match(/(\d{2})[./](\d{2})[./](\d{4})/);
  const asOf = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : new Date().toISOString().slice(0, 10);
  let rows: Row[] = grid.slice(hIdx + 1).filter((x) => x[cName] && x[cW] != null).map((x) => ({
    name: String(x[cName]),
    isin: cIsin >= 0 ? (x[cIsin] ? String(x[cIsin]) : null) : null,
    weight: Number(String(x[cW]).replace("%", "").replace(",", ".")),
    country: cCountry >= 0 ? (x[cCountry] ? String(x[cCountry]) : null) : null,
    currency: cCur >= 0 ? (x[cCur] ? String(x[cCur]) : null) : null,
    sector: cSector >= 0 ? (x[cSector] ? String(x[cSector]) : null) : null,
    asset_class: cType >= 0 && x[cType] && !/equity|share|stock/i.test(String(x[cType])) ? "Cash and/or Derivatives" : "Equity",
    exchange: cExch >= 0 ? (x[cExch] ? String(x[cExch]) : null) : null,
  }));
  const total = rows.reduce((s, x) => s + (x.weight > 0 ? x.weight : 0), 0);
  if (total > 1.5) rows = rows.map((x) => ({ ...x, weight: x.weight / 100 }));
  const { data, error } = await sb.rpc("import_etf_holdings", { p_asset_id: assetId, p_source: "xtrackers", p_as_of: asOf, p_rows: rows, p_provider_ref: null });
  if (error) throw new Error(error.message);
  return data as Result;
}

// ---------- Global X (Europa) ----------
// Cada fundo tem uma página /funds/<código> com o ISIN e um CSV completo em
// /api/funds/<código>/topholdingscsv (apesar do nome, traz todas as posições).
const GX = "https://globalxetfs.eu";
async function globalxSlug(isin: string): Promise<string | null> {
  const r = await fetch(`${GX}/sitemap.xml`, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const slugs = [...new Set([...(await r.text()).matchAll(/<loc>https:\/\/globalxetfs\.eu\/funds\/([a-z0-9-]+)<\/loc>/g)].map((m) => m[1]))];
  for (const slug of slugs.slice(0, 120)) {
    const p = await fetch(`${GX}/funds/${slug}`, { headers: { "User-Agent": UA } });
    if (p.ok && (await p.text()).includes(isin)) return slug;
  }
  return null;
}

async function globalxSync(sb: SupabaseClient, assetId: string, isin: string | null, ref: Record<string, unknown>): Promise<Result> {
  let slug = (ref.globalx_slug as string) ?? null;
  if (!slug && isin) slug = await globalxSlug(isin);
  if (!slug) throw new Error("Fundo Global X não encontrado pelo ISIN");
  const r = await fetch(`${GX}/api/funds/${slug}/topholdingscsv`, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" } });
  const csv = await r.text();
  if (!r.ok || !csv.startsWith("AS_OF_DATE")) throw new Error(`CSV Global X indisponível (HTTP ${r.status})`);
  const lines = csv.replace(/\r/g, "").split("\n");
  const head = csvFields(lines[0]).map((h) => h.toUpperCase());
  const c = (name: string) => head.indexOf(name);
  const cDate = c("AS_OF_DATE"), cName = c("NAME"), cW = c("NET_ASSETS"), cTicker = c("TICKER"), cMv = c("MARKET_VALUE"), cIsin = c("ISIN"), cCountry = c("COUNTRY");
  if (cName < 0 || cW < 0) throw new Error("Formato do CSV Global X não reconhecido");
  let asOf: string | null = null;
  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f[cDate] ?? "")) continue; // rodapé
    asOf ??= f[cDate];
    const isinCell = cIsin >= 0 ? f[cIsin] || null : null;
    rows.push({
      name: f[cName],
      symbol: cTicker >= 0 ? f[cTicker] || null : null,
      isin: isinCell,
      weight: Number(f[cW]) / 100,
      country: cCountry >= 0 ? countryName(f[cCountry]) : null,
      mv: cMv >= 0 && f[cMv] ? Number(f[cMv]) : null,
      asset_class: isinCell ? "Equity" : "Cash and/or Derivatives",
    });
  }
  return withFundSectorsKept(sb, assetId, rows, async () => {
    const { data, error } = await sb.rpc("import_etf_holdings", { p_asset_id: assetId, p_source: "globalx", p_as_of: asOf ?? new Date().toISOString().slice(0, 10), p_rows: rows, p_provider_ref: { globalx_slug: slug } });
    if (error) throw new Error(error.message);
    return data as Result;
  });
}

// ---------- VanEck (Europa) ----------
// O site só mostra a composição depois do aviso de investidor. O utilizador
// autorizou declarar "investidor particular em Portugal" (15/10/2026); estes
// cookies são os que o site grava ao aceitar esse aviso.
const VK = "https://www.vaneck.com";
const VK_COOKIE = "ve-country-pt=iso%3Dpt%26investortype%3Dretail%26language%3Den%26disclaimer%3Dtrue%26foreigntax%3Dfalse%26foreigntaxdisclaimer%3Dfalse; ve-country=current%3Dpt%26previous%3D; visitortype=user; sitelanguage=en";
const VK_HEADERS = { "User-Agent": UA, Cookie: VK_COOKIE };

/** Encontra o código do produto (ex.: nuclear-etf) pelo ISIN, a partir do sitemap. */
async function vaneckSlug(isin: string): Promise<string | null> {
  const r = await fetch(`${VK}/ie/sitemap.xml`, { headers: VK_HEADERS });
  if (!r.ok) return null;
  const slugs = [...new Set([...(await r.text()).matchAll(/<loc>https:\/\/www\.vaneck\.com\/ie\/en\/investments\/([a-z0-9-]+)\/<\/loc>/g)].map((m) => m[1]))];
  for (const slug of slugs.slice(0, 120)) {
    const p = await fetch(`${VK}/pt/en/investments/${slug}/overview/`, { headers: VK_HEADERS });
    if (p.ok && (await p.text()).includes(isin)) return slug;
  }
  return null;
}

async function vaneckSync(sb: SupabaseClient, assetId: string, isin: string | null, ref: Record<string, unknown>): Promise<Result> {
  let slug = (ref.vaneck_slug as string) ?? null;
  if (!slug && isin) slug = await vaneckSlug(isin);
  if (!slug) throw new Error("Fundo VanEck não encontrado pelo ISIN");
  const r = await fetch(`${VK}/pt/en/investments/${slug}/downloads/holdings/`, { headers: { ...VK_HEADERS, Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*" } });
  const ct = r.headers.get("content-type") ?? "";
  if (!r.ok || !ct.includes("spreadsheet")) throw new Error(`Excel VanEck indisponível (HTTP ${r.status})`);
  const XLSX = await import("npm:xlsx@0.18.5");
  const wb = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: "array" });
  const grid: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: null });
  const hIdx = grid.findIndex((row) => row.some((c) => /holding name/i.test(String(c ?? ""))) && row.some((c) => /net assets/i.test(String(c ?? ""))));
  if (hIdx < 0) throw new Error("Formato do Excel VanEck não reconhecido");
  const head = grid[hIdx].map((c) => String(c ?? "").trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const cName = col(/holding name/), cTicker = col(/^ticker$/), cIsin = col(/isin/), cMv = col(/market value/), cW = col(/net assets/);
  // "All Holdings  10/14/2026" (mês/dia/ano)
  const dm = grid.slice(0, hIdx).flat().map((c) => String(c ?? "")).join(" ").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const asOf = dm ? `${dm[3]}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}` : new Date().toISOString().slice(0, 10);
  const num = (v: unknown) => Number(String(v ?? "").replace(/[$%,\s]/g, ""));
  const rows: Row[] = grid.slice(hIdx + 1).filter((x) => x[cName] && x[cW] != null).map((x) => {
    const isinCell = cIsin >= 0 && /^[A-Z]{2}[A-Z0-9]{10}$/.test(String(x[cIsin] ?? "").trim()) ? String(x[cIsin]).trim() : null;
    const ticker = cTicker >= 0 ? String(x[cTicker] ?? "").trim() : "";
    return {
      name: String(x[cName]).trim(),
      symbol: ticker && ticker !== "--" ? ticker : null,
      isin: isinCell,
      weight: num(x[cW]) / 100,
      // Sem coluna de país: usa o país do emitente indicado no ISIN.
      country: isinCell ? countryName(isinCell.slice(0, 2)) : null,
      mv: cMv >= 0 && x[cMv] ? num(x[cMv]) : null,
      asset_class: isinCell ? "Equity" : "Cash and/or Derivatives",
    };
  });
  return withFundSectorsKept(sb, assetId, rows, async () => {
    const { data, error } = await sb.rpc("import_etf_holdings", { p_asset_id: assetId, p_source: "vaneck", p_as_of: asOf, p_rows: rows, p_provider_ref: { vaneck_slug: slug } });
    if (error) throw new Error(error.message);
    return data as Result;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Não autenticado" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "Não autenticado" }, 401);

  let assetId: string | undefined; let force = false;
  try { const b = await req.json(); assetId = b?.asset_id; force = !!b?.force; } catch { /* sem body = todos */ }

  let q = sb.from("assets").select("id, ticker, name, isin, asset_profiles(isin, provider_ref, manager_slug, as_of_date)").eq("class", "etf").eq("status", "open");
  if (assetId) q = q.eq("id", assetId);
  const { data: assets, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results: Result[] = [];
  for (const a of assets ?? []) {
    const p: any = Array.isArray(a.asset_profiles) ? a.asset_profiles[0] : a.asset_profiles;
    const ref = (p?.provider_ref ?? {}) as Record<string, unknown>;
    const isin = a.isin ?? p?.isin ?? null;
    const mgr = detectManager(a.name ?? "", p?.manager_slug);
    if (!mgr) { results.push({ ticker: a.ticker, ok: false, skipped: "gestora ainda não suportada" }); continue; }
    try {
      const r = mgr === "ishares" ? await isharesSync(sb, a.id, isin, ref)
        : mgr === "vanguard" ? await vanguardSync(sb, a.id, ref, p?.as_of_date ?? null, force)
        : mgr === "globalx" ? await globalxSync(sb, a.id, isin, ref)
        : mgr === "vaneck" ? await vaneckSync(sb, a.id, isin, ref)
        : await xtrackersSync(sb, a.id, isin);
      results.push({ ticker: a.ticker, manager: mgr, ...r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sb.from("asset_profiles").update({ holdings_error: msg, holdings_synced_at: new Date().toISOString() }).eq("asset_id", a.id);
      results.push({ ticker: a.ticker, manager: mgr, ok: false, error: msg });
    }
  }
  return json({ results });
});
