/**
 * Deteção pura da gestora de um ETF a partir de texto já disponível
 * (fundFamily da fonte genérica, nome oficial, ticker). Nunca usa LLM,
 * nunca faz I/O — só padrões de texto conhecidos e estáveis.
 *
 * O ISIN NÃO identifica a gestora (o prefixo de país é do emissor legal do
 * fundo/depositário, não da entidade gestora), por isso não é usado aqui.
 */
import type { ManagerLookupInput } from "@/lib/exposure-providers/types";

export type ManagerSlug =
  "ishares" | "vanguard" | "vaneck" | "wisdomtree" | "xtrackers" | "bnpparibas";

interface ManagerPattern {
  slug: ManagerSlug;
  label: string;
  /** Testado contra fundFamily + nome oficial, em minúsculas. */
  patterns: RegExp[];
}

const MANAGER_PATTERNS: ManagerPattern[] = [
  { slug: "ishares", label: "iShares", patterns: [/\bishares\b/, /\bblackrock\b/] },
  { slug: "vanguard", label: "Vanguard", patterns: [/\bvanguard\b/] },
  { slug: "vaneck", label: "VanEck", patterns: [/\bvaneck\b/] },
  { slug: "wisdomtree", label: "WisdomTree", patterns: [/\bwisdomtree\b/] },
  {
    slug: "xtrackers",
    label: "Xtrackers",
    patterns: [/\bxtrackers\b/, /\bdws\b/, /\bdb\s*x-?trackers\b/],
  },
  {
    slug: "bnpparibas",
    label: "BNP Paribas",
    patterns: [/\bbnp\s*paribas\b/, /\beasy\s*etf\b/],
  },
];

export const MANAGER_LABELS: Record<ManagerSlug, string> = Object.fromEntries(
  MANAGER_PATTERNS.map((m) => [m.slug, m.label]),
) as Record<ManagerSlug, string>;

/** Deteta a gestora a partir do fundFamily (fonte genérica) e/ou do nome oficial. */
export function detectManager(input: ManagerLookupInput): ManagerSlug | null {
  const haystack = `${input.fundFamily ?? ""} ${input.name ?? ""}`.toLowerCase();
  if (!haystack.trim()) return null;
  for (const m of MANAGER_PATTERNS) {
    if (m.patterns.some((re) => re.test(haystack))) return m.slug;
  }
  return null;
}
