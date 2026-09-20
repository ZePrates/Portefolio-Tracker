/**
 * Estruturas dos dados de composição devolvidos pelo JustETF.
 *
 * Um fornecedor NUNCA inventa dados: se não conseguir obter/confirmar a
 * composição, devolve `null` e a cadeia tenta o próximo. Nunca é usado LLM.
 */

export interface ProviderHolding {
  name: string;
  symbol: string | null;
  isin: string | null;
  /** Peso em fração (0–1), nunca normalizado para somar 1. */
  weight: number;
  country: string | null;
  sector: string | null;
  currency: string | null;
}

export interface ProviderResult {
  /** Identificador estável da fonte. */
  source: string;
  asOfDate: string | null;
  isin: string | null;
  officialName: string | null;
  indexTracked?: string | null;
  holdings: ProviderHolding[];
  /** Distribuição setorial publicada diretamente pela fonte (mais completa que as holdings). */
  sectorWeights?: Array<{ sector: string; weight: number }>;
  countryWeights?: Array<{ country: string; weight: number }>;
}
