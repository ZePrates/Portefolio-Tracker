/**
 * Cálculo puro da exposição da carteira (sem I/O, sem LLM).
 *
 * Exposição indireta: o valor de cada ETF é distribuído pelas suas posições
 * subjacentes de acordo com o peso publicado pela fonte. A exposição económica
 * a uma empresa é a soma da posição direta com a parte proporcional detida
 * através de ETFs.
 */
import {
  UNKNOWN,
  continentOf,
  currencyOfCountry,
  developmentOf,
  regionOf,
  sectorLabel,
  type CompanyExposure,
  type Dimension,
  type PositionInput,
  type Slice,
} from "@/lib/exposure-types";

const EQUITY_CLASSES = new Set(["reit", "acao_dividendo", "acao_crescimento"]);

export interface ExposureReport {
  total: number;
  byClass: Slice[];
  country: Slice[];
  region: Slice[];
  continent: Slice[];
  development: Slice[];
  sector: Slice[];
  industry: Slice[];
  currency: Slice[];
  companies: CompanyExposure[];
  concentration: {
    largest: number;
    top5: number;
    top10: number;
    topCountry: number;
    topSector: number;
    topCurrency: number;
  };
  /** Percentagem do valor da carteira com dados de exposição conhecidos (país). */
  coverage: number;
}

const CLASS_LABELS: Record<string, string> = {
  etf: "ETFs",
  reit: "REITs",
  acao_dividendo: "Ações Dividendos",
  acao_crescimento: "Ações Crescimento",
  metal: "Metais Preciosos",
  p2p: "P2P",
};

type Bucket = Map<
  string,
  { amount: number; contributors: Map<string, { name: string; amount: number }> }
>;

function add(bucket: Bucket, key: string, amount: number, assetId: string, assetName: string) {
  if (!(amount > 0)) return;
  let entry = bucket.get(key);
  if (!entry) {
    entry = { amount: 0, contributors: new Map() };
    bucket.set(key, entry);
  }
  entry.amount += amount;
  const c = entry.contributors.get(assetId);
  if (c) c.amount += amount;
  else entry.contributors.set(assetId, { name: assetName, amount });
}

function toSlices(bucket: Bucket, total: number): Slice[] {
  return [...bucket.entries()]
    .map(([value, e]) => ({
      value,
      amount: e.amount,
      pct: total > 0 ? (e.amount / total) * 100 : 0,
      contributors: [...e.contributors.entries()]
        .map(([assetId, c]) => ({ assetId, name: c.name, amount: c.amount }))
        .sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => {
      if (a.value === UNKNOWN) return 1;
      if (b.value === UNKNOWN) return -1;
      return b.amount - a.amount;
    });
}

/** Pesos declarados de uma dimensão para um ativo (fração 0–1), normalizados a <= 1. */
function weightsFor(position: PositionInput, dimension: Dimension): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of position.exposures) {
    if (e.dimension !== dimension) continue;
    const w = Number(e.weight) || 0;
    if (w <= 0) continue;
    const label = dimension === "sector" ? sectorLabel(e.value) : e.value;
    out.set(label, (out.get(label) ?? 0) + w);
  }
  const sum = [...out.values()].reduce((s, w) => s + w, 0);
  if (sum > 1.0001) for (const [k, v] of out) out.set(k, v / sum);
  return out;
}

/** Pesos derivados da composição (holdings) quando a fonte não publica a dimensão. */
function weightsFromHoldings(
  position: PositionInput,
  field: "country" | "sector",
): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of position.holdings) {
    const w = Number(h.weight) || 0;
    if (w <= 0) continue;
    const raw = field === "country" ? h.country : h.sector;
    if (!raw) continue;
    const label = field === "sector" ? sectorLabel(raw) : raw;
    out.set(label, (out.get(label) ?? 0) + w);
  }
  return out;
}

export function computeExposure(positions: PositionInput[]): ExposureReport {
  const active = positions.filter((p) => (Number(p.value) || 0) > 0);
  const total = active.reduce((s, p) => s + p.value, 0);

  const classB: Bucket = new Map();
  const countryB: Bucket = new Map();
  const regionB: Bucket = new Map();
  const continentB: Bucket = new Map();
  const developmentB: Bucket = new Map();
  const sectorB: Bucket = new Map();
  const industryB: Bucket = new Map();
  const currencyB: Bucket = new Map();

  const companies = new Map<string, CompanyExposure>();
  let knownCountryAmount = 0;

  for (const p of active) {
    add(classB, CLASS_LABELS[p.class] ?? p.class, p.value, p.assetId, p.name);

    // ---- Empresas: exposição direta e indireta ----
    if (p.class === "etf") {
      for (const h of p.holdings) {
        const w = Number(h.weight) || 0;
        if (w <= 0) continue;
        const amount = p.value * w;
        const key = (h.symbol || h.name).toUpperCase();
        const c = companies.get(key) ?? {
          name: h.name,
          symbol: h.symbol,
          direct: 0,
          indirect: 0,
          amount: 0,
          pct: 0,
          country: h.country ?? null,
          sector: h.sector ? sectorLabel(h.sector) : null,
          contributors: [],
        };
        c.indirect += amount;
        c.amount += amount;
        if (!c.country && h.country) c.country = h.country;
        if (!c.sector && h.sector) c.sector = sectorLabel(h.sector);
        c.contributors.push({ assetId: p.assetId, name: p.name, amount, via: "etf" });
        companies.set(key, c);
      }
    } else if (EQUITY_CLASSES.has(p.class)) {
      const key = (p.ticker || p.name).toUpperCase();
      const country = [...weightsFor(p, "country").keys()][0] ?? null;
      const sector = [...weightsFor(p, "sector").keys()][0] ?? null;
      const c = companies.get(key) ?? {
        name: p.name,
        symbol: p.ticker,
        direct: 0,
        indirect: 0,
        amount: 0,
        pct: 0,
        country,
        sector,
        contributors: [],
      };
      c.direct += p.value;
      c.amount += p.value;
      if (!c.country && country) c.country = country;
      if (!c.sector && sector) c.sector = sector;
      c.contributors.push({ assetId: p.assetId, name: p.name, amount: p.value, via: "direct" });
      companies.set(key, c);
    }

    // ---- Dimensões ----
    let country = weightsFor(p, "country");
    if (country.size === 0) country = weightsFromHoldings(p, "country");
    let sector = weightsFor(p, "sector");
    if (sector.size === 0) sector = weightsFromHoldings(p, "sector");
    const industry = weightsFor(p, "industry");
    let currency = weightsFor(p, "currency");

    if (currency.size === 0) {
      if (country.size > 0) {
        for (const [c, w] of country) {
          const cur = currencyOfCountry(c);
          currency.set(cur, (currency.get(cur) ?? 0) + w);
        }
      } else if (p.class !== "etf" && p.nativeCurrency) {
        currency = new Map([[p.nativeCurrency.toUpperCase(), 1]]);
      }
    }

    const spread = (bucket: Bucket, weights: Map<string, number>) => {
      let used = 0;
      for (const [value, w] of weights) {
        add(bucket, value, p.value * w, p.assetId, p.name);
        used += w;
      }
      const rest = 1 - used;
      if (rest > 0.0001) add(bucket, UNKNOWN, p.value * rest, p.assetId, p.name);
    };

    spread(countryB, country);
    spread(sectorB, sector);
    spread(industryB, industry);
    spread(currencyB, currency);

    // Dimensões derivadas do país (dinâmicas, sem lista fixa).
    const derived = (bucket: Bucket, fn: (c: string) => string) => {
      let used = 0;
      const agg = new Map<string, number>();
      for (const [c, w] of country) {
        const label = fn(c);
        agg.set(label, (agg.get(label) ?? 0) + w);
        used += w;
      }
      for (const [label, w] of agg) add(bucket, label, p.value * w, p.assetId, p.name);
      const rest = 1 - used;
      if (rest > 0.0001) add(bucket, UNKNOWN, p.value * rest, p.assetId, p.name);
    };
    derived(regionB, regionOf);
    derived(continentB, continentOf);
    derived(developmentB, developmentOf);

    const knownWeight = [...country.entries()]
      .filter(([c]) => c !== UNKNOWN)
      .reduce((s, [, w]) => s + w, 0);
    knownCountryAmount += p.value * Math.min(1, knownWeight);
  }

  const companyList = [...companies.values()]
    .map((c) => ({ ...c, pct: total > 0 ? (c.amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);

  const pctOf = (amount: number) => (total > 0 ? (amount / total) * 100 : 0);
  const sumTop = (n: number) => companyList.slice(0, n).reduce((s, c) => s + c.amount, 0);

  const country = toSlices(countryB, total);
  const sector = toSlices(sectorB, total);
  const currency = toSlices(currencyB, total);
  const named = (list: Slice[]) => list.filter((s) => s.value !== UNKNOWN);

  return {
    total,
    byClass: toSlices(classB, total),
    country,
    region: toSlices(regionB, total),
    continent: toSlices(continentB, total),
    development: toSlices(developmentB, total),
    sector,
    industry: toSlices(industryB, total),
    currency,
    companies: companyList,
    concentration: {
      largest: pctOf(companyList[0]?.amount ?? 0),
      top5: pctOf(sumTop(5)),
      top10: pctOf(sumTop(10)),
      topCountry: named(country)[0]?.pct ?? 0,
      topSector: named(sector)[0]?.pct ?? 0,
      topCurrency: named(currency)[0]?.pct ?? 0,
    },
    coverage: pctOf(knownCountryAmount),
  };
}
