/**
 * Registo e cadeia de fallback dos fornecedores de composição.
 *
 * Prioridade: fonte oficial da gestora → fornecedor especializado (justETF,
 * cobre qualquer gestora por ISIN) → Yahoo. Yahoo continua implementado em
 * @/lib/exposure.server e é chamado pelo lado de fora deste registo
 * (mantém-se sempre como último recurso).
 *
 * Adicionar um novo fornecedor por gestora = acrescentar um ManagerProvider
 * a PROVIDERS. Nenhum outro ficheiro precisa de mudar.
 */
import { isharesProvider } from "@/lib/exposure-providers/ishares.server";
import { vanguardProvider } from "@/lib/exposure-providers/vanguard.server";
import { fetchJustEtf } from "@/lib/exposure-providers/justetf.server";
import { detectManager } from "@/lib/exposure-providers/manager-detect";
import type {
  ManagerLookupInput,
  ManagerProvider,
  ProviderResult,
} from "@/lib/exposure-providers/types";

/** Fornecedores oficiais por gestora. Ordem irrelevante — só um pode corresponder. */
const PROVIDERS: ManagerProvider[] = [isharesProvider, vanguardProvider];

export function findManagerProvider(input: ManagerLookupInput): ManagerProvider | null {
  return PROVIDERS.find((p) => p.matches(input)) ?? null;
}

export { detectManager };

/**
 * Tenta obter a composição pela fonte oficial da gestora detetada e,
 * falhando essa, pelo fornecedor especializado (justETF — não depende de
 * reconhecer a gestora, só do ISIN). Devolve `null` só quando nenhum dos
 * dois responder; o chamador tenta então Yahoo.
 */
export async function fetchOfficialComposition(
  input: ManagerLookupInput,
): Promise<ProviderResult | null> {
  const provider = findManagerProvider(input);
  if (provider) {
    const result = await provider.fetch(input);
    if (result) return result;
  }
  return fetchJustEtf(input.isin);
}
