/**
 * Tipos e mapas de referência para a análise de exposição.
 * Os mapas aqui presentes são factos geográficos/monetários estáveis
 * (país → continente/região/moeda), nunca dados financeiros estimados.
 */

export type Dimension =
  | "country"
  | "region"
  | "continent"
  | "development"
  | "sector"
  | "industry"
  | "currency";

export const UNKNOWN = "Não disponível";

export interface ExposureRecord {
  dimension: Dimension;
  /** Nome legível da categoria (ex.: "United States", "Technology"). */
  value: string;
  /** Peso em fração (0–1) dentro do ativo. */
  weight: number;
  source?: string | null;
  as_of_date?: string | null;
}

export interface HoldingRecord {
  name: string;
  symbol: string | null;
  /** Peso em fração (0–1) dentro do ETF. */
  weight: number;
  country: string | null;
  sector: string | null;
  currency?: string | null;
  as_of_date?: string | null;
}

export interface PositionInput {
  assetId: string;
  name: string;
  /** Classe interna: etf | reit | acao_dividendo | acao_crescimento | metal | p2p */
  class: string;
  ticker: string | null;
  /** Valor atual em EUR. */
  value: number;
  nativeCurrency: string;
  exposures: ExposureRecord[];
  holdings: HoldingRecord[];
}

export interface Slice {
  value: string;
  amount: number;
  pct: number;
  contributors: { assetId: string; name: string; amount: number }[];
}

export interface CompanyExposure {
  name: string;
  symbol: string | null;
  direct: number;
  indirect: number;
  amount: number;
  pct: number;
  country: string | null;
  sector: string | null;
  contributors: { assetId: string; name: string; amount: number; via: "direct" | "etf" }[];
}

/** País → continente. */
const CONTINENT: Record<string, string> = {
  "United States": "América do Norte",
  Canada: "América do Norte",
  Mexico: "América do Norte",
  Brazil: "América do Sul",
  Chile: "América do Sul",
  Argentina: "América do Sul",
  Colombia: "América do Sul",
  Peru: "América do Sul",
  Portugal: "Europa",
  Spain: "Europa",
  France: "Europa",
  Germany: "Europa",
  Italy: "Europa",
  Netherlands: "Europa",
  Belgium: "Europa",
  Ireland: "Europa",
  Luxembourg: "Europa",
  Austria: "Europa",
  Switzerland: "Europa",
  "United Kingdom": "Europa",
  Sweden: "Europa",
  Norway: "Europa",
  Denmark: "Europa",
  Finland: "Europa",
  Poland: "Europa",
  "Czech Republic": "Europa",
  Hungary: "Europa",
  Greece: "Europa",
  Turkey: "Europa",
  Russia: "Europa",
  Japan: "Ásia",
  China: "Ásia",
  "Hong Kong": "Ásia",
  Taiwan: "Ásia",
  "South Korea": "Ásia",
  Korea: "Ásia",
  India: "Ásia",
  Singapore: "Ásia",
  Indonesia: "Ásia",
  Thailand: "Ásia",
  Malaysia: "Ásia",
  Philippines: "Ásia",
  Vietnam: "Ásia",
  Israel: "Ásia",
  "United Arab Emirates": "Ásia",
  "Saudi Arabia": "Ásia",
  Qatar: "Ásia",
  Australia: "Oceânia",
  "New Zealand": "Oceânia",
  "South Africa": "África",
  Nigeria: "África",
  Egypt: "África",
  Morocco: "África",
  Kenya: "África",
};

/** País → região de mercado. */
const REGION: Record<string, string> = {
  "United States": "América do Norte",
  Canada: "América do Norte",
  Mexico: "América Latina",
  Brazil: "América Latina",
  Chile: "América Latina",
  Argentina: "América Latina",
  Colombia: "América Latina",
  Peru: "América Latina",
  "United Kingdom": "Reino Unido",
  Japan: "Japão",
  China: "Ásia Emergente",
  "Hong Kong": "Ásia Desenvolvida",
  Taiwan: "Ásia Emergente",
  "South Korea": "Ásia Emergente",
  Korea: "Ásia Emergente",
  India: "Ásia Emergente",
  Singapore: "Ásia Desenvolvida",
  Indonesia: "Ásia Emergente",
  Thailand: "Ásia Emergente",
  Malaysia: "Ásia Emergente",
  Philippines: "Ásia Emergente",
  Vietnam: "Ásia Emergente",
  Australia: "Pacífico",
  "New Zealand": "Pacífico",
  Israel: "Médio Oriente",
  "United Arab Emirates": "Médio Oriente",
  "Saudi Arabia": "Médio Oriente",
  Qatar: "Médio Oriente",
  "South Africa": "África",
  Nigeria: "África",
  Egypt: "África",
  Morocco: "África",
  Kenya: "África",
};

/** Mercados classificados como desenvolvidos (MSCI Developed Markets). */
const DEVELOPED = new Set([
  "United States",
  "Canada",
  "United Kingdom",
  "Japan",
  "Australia",
  "New Zealand",
  "Singapore",
  "Hong Kong",
  "Israel",
  "Portugal",
  "Spain",
  "France",
  "Germany",
  "Italy",
  "Netherlands",
  "Belgium",
  "Ireland",
  "Luxembourg",
  "Austria",
  "Switzerland",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
]);

const EUROPE_EMERGING = new Set(["Poland", "Czech Republic", "Hungary", "Greece", "Turkey", "Russia"]);

/** País → moeda oficial (exposição económica subjacente). */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  "United States": "USD",
  Canada: "CAD",
  Mexico: "MXN",
  Brazil: "BRL",
  Chile: "CLP",
  Argentina: "ARS",
  Colombia: "COP",
  Peru: "PEN",
  Portugal: "EUR",
  Spain: "EUR",
  France: "EUR",
  Germany: "EUR",
  Italy: "EUR",
  Netherlands: "EUR",
  Belgium: "EUR",
  Ireland: "EUR",
  Luxembourg: "EUR",
  Austria: "EUR",
  Finland: "EUR",
  Greece: "EUR",
  Switzerland: "CHF",
  "United Kingdom": "GBP",
  Sweden: "SEK",
  Norway: "NOK",
  Denmark: "DKK",
  Poland: "PLN",
  "Czech Republic": "CZK",
  Hungary: "HUF",
  Turkey: "TRY",
  Russia: "RUB",
  Japan: "JPY",
  China: "CNY",
  "Hong Kong": "HKD",
  Taiwan: "TWD",
  "South Korea": "KRW",
  Korea: "KRW",
  India: "INR",
  Singapore: "SGD",
  Indonesia: "IDR",
  Thailand: "THB",
  Malaysia: "MYR",
  Philippines: "PHP",
  Vietnam: "VND",
  Israel: "ILS",
  "United Arab Emirates": "AED",
  "Saudi Arabia": "SAR",
  Qatar: "QAR",
  Australia: "AUD",
  "New Zealand": "NZD",
  "South Africa": "ZAR",
  Nigeria: "NGN",
  Egypt: "EGP",
  Morocco: "MAD",
  Kenya: "KES",
};

export function continentOf(country: string | null | undefined): string {
  if (!country) return UNKNOWN;
  return CONTINENT[country] ?? UNKNOWN;
}

export function regionOf(country: string | null | undefined): string {
  if (!country) return UNKNOWN;
  if (REGION[country]) return REGION[country] as string;
  if (CONTINENT[country] === "Europa") return EUROPE_EMERGING.has(country) ? "Europa Emergente" : "Europa Desenvolvida";
  return CONTINENT[country] ?? UNKNOWN;
}

export function developmentOf(country: string | null | undefined): string {
  if (!country) return UNKNOWN;
  if (DEVELOPED.has(country)) return "Desenvolvido";
  if (CONTINENT[country] || REGION[country]) return "Emergente";
  return UNKNOWN;
}

export function currencyOfCountry(country: string | null | undefined): string {
  if (!country) return UNKNOWN;
  return CURRENCY_BY_COUNTRY[country] ?? UNKNOWN;
}

/** Nomes de setor devolvidos pelo Yahoo (chaves) → etiquetas em português. */
export const SECTOR_LABELS: Record<string, string> = {
  technology: "Tecnologia",
  financial_services: "Financeiro",
  financialservices: "Financeiro",
  healthcare: "Saúde",
  industrials: "Indústria",
  consumer_cyclical: "Consumo Cíclico",
  consumercyclical: "Consumo Cíclico",
  consumer_defensive: "Consumo Defensivo",
  consumerdefensive: "Consumo Defensivo",
  energy: "Energia",
  utilities: "Utilities",
  realestate: "Imobiliário",
  real_estate: "Imobiliário",
  communication_services: "Comunicações",
  communicationservices: "Comunicações",
  basic_materials: "Materiais",
  basicmaterials: "Materiais",
};

export function sectorLabel(raw: string | null | undefined): string {
  if (!raw) return UNKNOWN;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  return SECTOR_LABELS[key] ?? SECTOR_LABELS[key.replace(/_/g, "")] ?? raw.trim();
}
