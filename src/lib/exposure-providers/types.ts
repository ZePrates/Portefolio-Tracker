/**
 * Arquitetura de fornecedores de composição de ETFs.
 *
 * Prioridade: fonte oficial da gestora → fornecedor especializado → Yahoo
 * (Yahoo continua implementado em @/lib/exposure.server, fora deste registo).
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
  /** Identificador estável da fonte: "ishares" | "vanguard" | "yahoo" | ... */
  source: string;
  asOfDate: string | null;
  isin: string | null;
  officialName: string | null;
  indexTracked?: string | null;
  holdings: ProviderHolding[];
  /** Distribuição setorial publicada diretamente pela fonte (mais completa que as holdings). */
  sectorWeights?: Array<{ sector: string; weight: number }>;
  countryWeights?: Array<{ country: string; weight: number }>;
  /** Referência de produto resolvida nesta fonte — o chamador guarda-a para reutilizar. */
  providerRef?: unknown;
}

export interface ManagerLookupInput {
  isin: string | null;
  ticker: string | null;
  name: string;
  /** Nome da gestora tal como devolvido pela fonte genérica (ex.: Yahoo fundFamily). */
  fundFamily: string | null;
  /** Referência de produto já resolvida numa sincronização anterior (cache), se houver. */
  cachedRef?: unknown;
}

export interface ManagerProvider {
  /** Identificador estável — também usado como `source` no ProviderResult e como manager_slug. */
  slug: string;
  /** Nome legível para a interface. */
  label: string;
  /** Verifica se este fornecedor é responsável pela gestora do ETF. */
  matches(input: ManagerLookupInput): boolean;
  /**
   * Obtém a composição diretamente da fonte oficial.
   * Devolve `null` sempre que a fonte falhar, não responder, ou não publicar
   * uma composição estruturada suficientemente completa — NUNCA lança para
   * fora do fornecedor (erros de rede/parse são capturados internamente).
   */
  fetch(input: ManagerLookupInput): Promise<ProviderResult | null>;
}
