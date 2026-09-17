/**
 * Registo e cadeia de fallback dos fornecedores de composição.
 *
 * Prioridade: fonte oficial da gestora → (fornecedor especializado, quando
 * existir) → Yahoo. Yahoo continua implementado em @/lib/exposure.server e
 * é chamado pelo lado de fora deste registo (mantém-se sempre como último
 * recurso, mesmo que nenhuma gestora seja reconhecida).
 *
 * Adicionar um novo fornecedor = acrescentar um ManagerProvider a PROVIDERS.
 * Nenhum outro ficheiro precisa de mudar.
 */
import { isharesProvider } from "@/lib/exposure-providers/ishares.server";
import { vanguardProvider } from "@/lib/exposure-providers/vanguard.server";
import { detectManager } from "@/lib/exposure-providers/manager-detect";
import type {
  ManagerLookupInput,
  ManagerProvider,
  ProviderResult,
} from "@/lib/exposure-providers/types";

/** Fornecedores oficiais implementados. Ordem irrelevante — só um pode corresponder à gestora. */
const PROVIDERS: ManagerProvider[] = [isharesProvider, vanguardProvider];

export function findManagerProvider(input: ManagerLookupInput): ManagerProvider | null {
  return PROVIDERS.find((p) => p.matches(input)) ?? null;
}

export { detectManager };

/**
 * Tenta obter a composição pela fonte oficial da gestora detetada.
 * Devolve `null` quando a gestora não é reconhecida, não tem fornecedor
 * implementado, ou a fonte falhar — o chamador deve então tentar Yahoo.
 */
export async function fetchOfficialComposition(
  input: ManagerLookupInput,
): Promise<ProviderResult | null> {
  const provider = findManagerProvider(input);
  if (!provider) return null;
  return provider.fetch(input);
}
