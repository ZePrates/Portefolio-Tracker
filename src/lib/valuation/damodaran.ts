/**
 * Consulta das tabelas do Damodaran: indústria de referência, risco do país
 * e rating sintético (custo da dívida a partir da cobertura de juros).
 */

import { COUNTRY_TABLE, INDUSTRY_TABLE, MATURE_MARKET_ERP } from "@/lib/valuation/damodaran-data";
import { isNum } from "@/lib/valuation/stats";

export interface IndustryRef {
  name: string;
  firms: number;
  /** Beta alavancado médio da indústria. */
  beta: number | null;
  /** Beta desalavancado (Hamada): beta / (1 + (1 − t) × D/E). */
  unleveredBeta: number | null;
  debtToCapital: number | null;
  taxRate: number | null;
  costOfCapital: number | null;
  evEbitda: number | null;
  evEbit: number | null;
  pe: number | null;
  forwardPe: number | null;
  growth5y: number | null;
  evSales: number | null;
  ps: number | null;
  pb: number | null;
  roe: number | null;
  roic: number | null;
  operatingMargin: number | null;
  ebitdaMargin: number | null;
  netMargin: number | null;
  grossMargin: number | null;
}

export interface CountryRisk {
  country: string;
  rating: string | null;
  /** Spread de incumprimento soberano ajustado. */
  defaultSpread: number;
  /** Prémio de risco do país (CRP). */
  crp: number;
  /** ERP total = ERP maduro + CRP. */
  erp: number;
  /** Taxa de IRC marginal. */
  taxRate: number | null;
  /** false quando o país não está na tabela (usa-se um mercado maduro). */
  found: boolean;
}

const cell = (v: string | undefined): number | null => {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseIndustryTable(csv: string): IndustryRef[] {
  return csv
    .trim()
    .split("\n")
    .map((line) => line.split(";"))
    .filter((c) => c.length >= 20)
    .map((c) => {
      const beta = cell(c[2]);
      const dc = cell(c[3]);
      const tax = cell(c[4]);
      const de = dc != null && dc < 1 ? dc / (1 - dc) : null;
      const unlevered = beta != null && de != null ? beta / (1 + (1 - (tax ?? 0)) * de) : beta;
      return {
        name: c[0]!,
        firms: cell(c[1]) ?? 0,
        beta,
        unleveredBeta: unlevered != null ? Math.round(unlevered * 1000) / 1000 : null,
        debtToCapital: dc,
        taxRate: tax,
        costOfCapital: cell(c[5]),
        evEbitda: cell(c[6]),
        evEbit: cell(c[7]),
        pe: cell(c[8]),
        forwardPe: cell(c[9]),
        growth5y: cell(c[10]),
        evSales: cell(c[11]),
        ps: cell(c[12]),
        pb: cell(c[13]),
        roe: cell(c[14]),
        roic: cell(c[15]),
        operatingMargin: cell(c[16]),
        ebitdaMargin: cell(c[17]),
        netMargin: cell(c[18]),
        grossMargin: cell(c[19]),
      };
    });
}

let industries: IndustryRef[] | null = null;
function allIndustries(): IndustryRef[] {
  industries ??= parseIndustryTable(INDUSTRY_TABLE);
  return industries;
}

export function industryByName(name: string): IndustryRef | null {
  return allIndustries().find((i) => i.name === name) ?? null;
}

/** Agregado de todo o mercado dos EUA (referência quando a indústria não se identifica). */
export function marketAggregate(): IndustryRef {
  return industryByName("Total Market")!;
}

/**
 * Regras indústria do Yahoo → indústria do Damodaran. A ordem conta: as regras
 * mais específicas vêm primeiro ("semiconductor equipment" antes de "semiconductor").
 */
const INDUSTRY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/semiconductor equipment/, "Semiconductor Equip"],
  [/semiconductor/, "Semiconductor"],
  [/solar/, "Green & Renewable Energy"],
  [/software/, "Software (System & Application)"],
  [/electronic gaming|multimedia/, "Software (Entertainment)"],
  [/internet content|internet information/, "Software (Internet)"],
  [/internet retail|discount stores|department stores/, "Retail (General)"],
  [/consumer electronics/, "Electronics (Consumer & Office)"],
  [/computer hardware/, "Computers/Peripherals"],
  [/communication equipment/, "Telecom. Equipment"],
  [
    /electronic components|scientific|technical instruments|computer distribution/,
    "Electronics (General)",
  ],
  [/information technology services/, "Computer Services"],
  [/telecom/, "Telecom. Services"],
  [/entertainment/, "Entertainment"],
  [/advertising/, "Advertising"],
  [/broadcasting/, "Broadcasting"],
  [/publishing/, "Publishing & Newspapers"],
  [/auto & truck dealerships/, "Retail (Automotive)"],
  [/auto manufacturers/, "Auto & Truck"],
  [/auto parts/, "Auto Parts"],
  [/restaurants/, "Restaurant/Dining"],
  [/home improvement/, "Retail (Building Supply)"],
  [/luxury|apparel manufacturing|textile/, "Apparel"],
  [/apparel retail|specialty retail/, "Retail (Special Lines)"],
  [/footwear/, "Shoe"],
  [/packaging/, "Packaging & Container"],
  [/residential construction/, "Homebuilding"],
  [/travel|lodging|resorts|casinos|gambling/, "Hotel/Gaming"],
  [/leisure|recreational/, "Recreation"],
  [/furnishings|fixtures|appliances/, "Furn/Home Furnishings"],
  [/beverages.*non-alcoholic|soft drinks/, "Beverage (Soft)"],
  [/brewers|wineries|distilleries/, "Beverage (Alcoholic)"],
  [/household|personal products/, "Household Products"],
  [/packaged foods|confectioners/, "Food Processing"],
  [/farm products|agricultural/, "Farming/Agriculture"],
  [/grocery/, "Retail (Grocery and Food)"],
  [/tobacco/, "Tobacco"],
  [/food distribution/, "Food Wholesalers"],
  [/education/, "Education"],
  [/drug manufacturers/, "Drugs (Pharmaceutical)"],
  [/biotechnology/, "Drugs (Biotechnology)"],
  [/medical devices|medical instruments|diagnostics/, "Healthcare Products"],
  [/healthcare plans|medical distribution|pharmaceutical retailers/, "Healthcare Support Services"],
  [/medical care facilities/, "Hospitals/Healthcare Facilities"],
  [/health information/, "Healthcare Information and Technology"],
  [/banks.*diversified/, "Bank (Money Center)"],
  [/bank/, "Banks (Regional)"],
  [/asset management/, "Investments & Asset Management"],
  [/capital markets|financial data|stock exchanges/, "Brokerage & Investment Banking"],
  [
    /credit services|mortgage finance|financial conglomerates/,
    "Financial Svcs. (Non-bank & Insurance)",
  ],
  [/reinsurance/, "Reinsurance"],
  [/insurance.*life/, "Insurance (Life)"],
  [/insurance.*(property|casualty)/, "Insurance (Prop/Cas.)"],
  [/insurance/, "Insurance (General)"],
  [/aerospace|defense/, "Aerospace/Defense"],
  [/railroads/, "Transportation (Railroads)"],
  [/machinery|tools & accessories|metal fabrication/, "Machinery"],
  [/industrial distribution/, "Retail (Distributors)"],
  [/building products/, "Building Materials"],
  [/engineering & construction|infrastructure operations/, "Engineering/Construction"],
  [/conglomerates/, "Diversified"],
  [/airlines/, "Air Transport"],
  [/freight|logistics|airports/, "Transportation"],
  [/trucking/, "Trucking"],
  [/marine shipping/, "Shipbuilding & Marine"],
  [/waste management|pollution/, "Environmental & Waste Services"],
  [/electrical equipment/, "Electrical Equipment"],
  [/business equipment/, "Office Equipment & Services"],
  [
    /business services|consulting|staffing|rental & leasing|security & protection|personal services/,
    "Business & Consumer Services",
  ],
  [/oil & gas integrated|refining/, "Oil/Gas (Integrated)"],
  [/oil & gas e&p|oil & gas drilling/, "Oil/Gas (Production and Exploration)"],
  [/midstream/, "Oil/Gas Distribution"],
  [/oil & gas equipment/, "Oilfield Svcs/Equip."],
  [/coal|uranium/, "Coal & Related Energy"],
  [/specialty chemicals/, "Chemical (Specialty)"],
  [/chemicals/, "Chemical (Diversified)"],
  [/gold|silver|precious/, "Precious Metals"],
  [/steel/, "Steel"],
  [/copper|aluminum|industrial metals|mining/, "Metals & Mining"],
  [/building materials/, "Building Materials"],
  [/lumber|paper/, "Paper/Forest Products"],
  [/reit.*retail/, "Retail (REITs)"],
  [/reit/, "R.E.I.T."],
  [/real estate.*development/, "Real Estate (Development)"],
  [/real estate services/, "Real Estate (Operations & Services)"],
  [/real estate/, "Real Estate (General/Diversified)"],
  [/water/, "Utility (Water)"],
  [/renewable/, "Green & Renewable Energy"],
  [/independent power/, "Power"],
  [/utilities/, "Utility (General)"],
];

/** Indústria por omissão para cada setor do Yahoo quando nenhuma regra acerta. */
const SECTOR_FALLBACK: Record<string, string> = {
  technology: "Software (System & Application)",
  "communication services": "Telecom. Services",
  "consumer cyclical": "Retail (Special Lines)",
  "consumer defensive": "Food Processing",
  healthcare: "Healthcare Products",
  "financial services": "Financial Svcs. (Non-bank & Insurance)",
  industrials: "Machinery",
  energy: "Oil/Gas (Integrated)",
  "basic materials": "Chemical (Diversified)",
  "real estate": "R.E.I.T.",
  utilities: "Utility (General)",
};

export interface IndustryMatch {
  industry: IndustryRef;
  /** "industria" = regra direta; "setor" = só pelo setor; "mercado" = agregado. */
  match: "industria" | "setor" | "mercado";
}

export function mapIndustry(sector: string | null, industry: string | null): IndustryMatch {
  const ind = (industry ?? "").toLowerCase().replace(/[—–]/g, "-");
  if (ind) {
    for (const [re, name] of INDUSTRY_RULES) {
      if (re.test(ind)) {
        const ref = industryByName(name);
        if (ref) return { industry: ref, match: "industria" };
      }
    }
  }
  const fb = SECTOR_FALLBACK[(sector ?? "").toLowerCase()];
  const ref = fb ? industryByName(fb) : null;
  if (ref) return { industry: ref, match: "setor" };
  return { industry: marketAggregate(), match: "mercado" };
}

/* ------------------------------------------------------------------ */
/* Risco do país                                                       */
/* ------------------------------------------------------------------ */

let countries: Map<string, CountryRisk> | null = null;
function countryMap(): Map<string, CountryRisk> {
  if (countries) return countries;
  countries = new Map();
  for (const line of COUNTRY_TABLE.trim().split("\n")) {
    const c = line.split(";");
    if (c.length < 6) continue;
    const crp = cell(c[3]);
    const erp = cell(c[4]);
    if (crp == null || erp == null) continue;
    countries.set(c[0]!.toLowerCase(), {
      country: c[0]!,
      rating: c[1] && c[1] !== "NR" ? c[1] : null,
      defaultSpread: cell(c[2]) ?? 0,
      crp,
      erp,
      taxRate: cell(c[5]),
      found: true,
    });
  }
  return countries;
}

/** Nomes do Yahoo que não coincidem com os da tabela. */
const COUNTRY_ALIASES: Record<string, string> = {
  "south korea": "korea",
  "republic of korea": "korea",
  "czech republic": "czech republic",
  "russian federation": "russia",
  "the netherlands": "netherlands",
  uk: "united kingdom",
  usa: "united states",
  macau: "macao",
  jersey: "jersey (states of)",
  guernsey: "guernsey (states of)",
  "isle of man": "isle of man",
};

export function countryRisk(country: string | null): CountryRisk {
  const key = (country ?? "").trim().toLowerCase();
  const map = countryMap();
  const hit = map.get(COUNTRY_ALIASES[key] ?? key) ?? map.get(key);
  if (hit) return hit;
  return {
    country: country?.trim() || "Desconhecido",
    rating: null,
    defaultSpread: 0,
    crp: 0,
    erp: MATURE_MARKET_ERP,
    taxRate: null,
    found: false,
  };
}

/* ------------------------------------------------------------------ */
/* Rating sintético (cobertura de juros → spread)                       */
/* ------------------------------------------------------------------ */

/** [cobertura mínima, rating, spread] — grandes empresas não financeiras, jan/2026. */
const RATINGS_NONFIN: ReadonlyArray<readonly [number, string, number]> = [
  [8.5, "AAA", 0.004],
  [6.5, "AA", 0.0055],
  [5.5, "A+", 0.007],
  [4.25, "A", 0.0078],
  [3, "A-", 0.0089],
  [2.5, "BBB", 0.0111],
  [2.25, "BB+", 0.0138],
  [2, "BB", 0.0184],
  [1.75, "B+", 0.0275],
  [1.5, "B", 0.0321],
  [1.25, "B-", 0.0509],
  [0.8, "CCC", 0.0885],
  [0.65, "CC", 0.1261],
  [0.2, "C", 0.16],
  [-Infinity, "D", 0.19],
];

/** Mesmos spreads, com os limiares de cobertura das empresas financeiras. */
const RATINGS_FIN: ReadonlyArray<readonly [number, string, number]> = [
  [3, "AAA", 0.004],
  [2.5, "AA", 0.0055],
  [2, "A+", 0.007],
  [1.5, "A", 0.0078],
  [1.2, "A-", 0.0089],
  [0.9, "BBB", 0.0111],
  [0.75, "BB+", 0.0138],
  [0.6, "BB", 0.0184],
  [0.5, "B+", 0.0275],
  [0.4, "B", 0.0321],
  [0.3, "B-", 0.0509],
  [0.2, "CCC", 0.0885],
  [0.1, "CC", 0.1261],
  [0.05, "C", 0.16],
  [-Infinity, "D", 0.19],
];

export interface SyntheticRating {
  rating: string;
  spread: number;
  /** Cobertura de juros usada (EBIT / juros); null = sem dívida relevante. */
  coverage: number | null;
}

/**
 * Rating sintético do Damodaran: a cobertura de juros (EBIT / juros) dá um
 * rating e o respetivo spread sobre a taxa sem risco. Sem juros, é AAA.
 */
export function syntheticRating(
  ebit: number | null,
  interest: number | null,
  financial = false,
): SyntheticRating {
  const table = financial ? RATINGS_FIN : RATINGS_NONFIN;
  const int = isNum(interest) ? Math.abs(interest) : 0;
  if (!isNum(ebit)) return { rating: "BBB", spread: 0.0111, coverage: null };
  if (int <= 0) return { rating: "AAA", spread: table[0]![2], coverage: null };
  const coverage = ebit / int;
  const row = table.find(([min]) => coverage >= min) ?? table[table.length - 1]!;
  return { rating: row[1], spread: row[2], coverage };
}

/** Spread de uma obrigação AAA (para aproximar o rendimento Aaa do modelo de Yardeni). */
export const AAA_SPREAD = RATINGS_NONFIN[0]![2];
