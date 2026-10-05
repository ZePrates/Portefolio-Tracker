import type { Asset } from "@/lib/portfolio-types";
import { assetCurrentValue, isOpenPosition } from "@/lib/portfolio-types";
import type { ExposureReport } from "@/lib/exposure";
import type { PositionInput } from "@/lib/exposure-types";

export interface CompanyExposure {
  label: string;
  /** Fração do valor da carteira (0–1) atribuída a esta empresa, já somando posições diretas + peso dentro de ETFs. */
  weight: number;
}

export interface Intelligence {
  score: number;
  risks: string[];
  recommendations: string[];
  metrics: {
    /** Maior exposição económica a UMA empresa, somando posição direta + peso dentro de qualquer ETF (look-through). */
    largestCompany: number;
    /** As 5 maiores exposições a empresas, na mesma base look-through. */
    top5Companies: number;
    /** Fração da carteira cuja composição subjacente não é conhecida (ETFs sem holdings sincronizadas, ou parcialmente cobertos). */
    unknownLookThrough: number;
    topSector: number;
    topCountry: number;
    topCurrency: number;
    coverage: number;
  };
  /** Perfil de alocação por tipo de instrumento — informativo, NUNCA usado para penalizar o score (ver nota abaixo). */
  instrumentMix: Array<{ class: string; weight: number }>;
  /** As maiores exposições a empresas individuais, já com o look-through aplicado. */
  topCompanies: CompanyExposure[];
}

/**
 * Normaliza um nome de empresa para servir de chave de correspondência entre
 * uma posição direta (ex.: "Microsoft") e a mesma empresa aparecendo dentro
 * de um ETF (ex.: "MICROSOFT CORP"). É correspondência aproximada por nome
 * (maiúsculas, sem sufixos societários comuns, sem pontuação/classe de
 * ações) — não é perfeita, mas é a única chave disponível de forma
 * consistente em todas as fontes (nem todas as holdings de ETF trazem
 * ticker ou ISIN).
 */
function normalizeCompanyKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bCLASS\s+[A-Z]\b|\bCL\s+[A-Z]\b/g, "")
    .replace(
      /\b(INC|CORP|CORPORATION|CO|LTD|LIMITED|PLC|GROUP|HOLDINGS?|COMPANY|SA|S\.A\.?|NV|N\.V\.?|SE|AG|A\/S)\b\.?/g,
      "",
    )
    .replace(/[.,&]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ETF_LIKE_CLASSES = new Set(["etf"]);

interface LookThroughResult {
  companies: CompanyExposure[];
  unknownWeight: number;
}

/**
 * Distribui o valor de cada posição pela empresa final: posições diretas
 * (ações, REITs, metais) contam como uma "empresa" só sua; posições em ETF
 * são repartidas pelas suas holdings conhecidas, na proporção do peso de
 * cada uma — a parte da holding do ETF sem composição conhecida entra como
 * "unknownWeight", nunca é atribuída a uma empresa ao acaso.
 */
export function computeLookThrough(positions: PositionInput[], total: number): LookThroughResult {
  const byKey = new Map<string, CompanyExposure>();
  let unknownValue = 0;
  if (total <= 0) return { companies: [], unknownWeight: 0 };

  for (const p of positions) {
    if (p.value <= 0) continue;
    if (ETF_LIKE_CLASSES.has(p.class) && p.holdings.length > 0) {
      let knownWeight = 0;
      for (const h of p.holdings) {
        const w = Number(h.weight) || 0;
        if (w <= 0) continue;
        knownWeight += w;
        const key = normalizeCompanyKey(h.name || h.symbol || "");
        const label = h.name || h.symbol || "Desconhecido";
        const existing = byKey.get(key);
        const addedValue = p.value * w;
        if (existing) existing.weight += addedValue / total;
        else byKey.set(key, { label, weight: addedValue / total });
      }
      unknownValue += p.value * Math.max(0, 1 - knownWeight);
    } else {
      const key = normalizeCompanyKey(p.name);
      const existing = byKey.get(key);
      if (existing) existing.weight += p.value / total;
      else byKey.set(key, { label: p.name, weight: p.value / total });
    }
  }

  const companies = [...byKey.values()].sort((a, b) => b.weight - a.weight);
  return { companies, unknownWeight: total ? unknownValue / total : 0 };
}

export function portfolioIntelligence(
  assets: Asset[],
  exposure?: ExposureReport,
  positions?: PositionInput[],
): Intelligence {
  const open = assets.filter(isOpenPosition);
  const total = open.reduce((s, a) => s + assetCurrentValue(a), 0);

  // Perfil de alocação por instrumento — só descritivo, nunca penaliza o score:
  // um ETF é, por natureza, já diversificado por dentro; ter 60% em ETFs não
  // é o mesmo risco que ter 60% numa única ação. É por isso que a
  // concentração real (largestCompany) é calculada à parte, com look-through.
  const classVals = new Map<string, number>();
  for (const a of open)
    classVals.set(a.class, (classVals.get(a.class) || 0) + assetCurrentValue(a));
  const instrumentMix = [...classVals.entries()]
    .map(([cls, v]) => ({ class: cls, weight: total ? v / total : 0 }))
    .sort((a, b) => b.weight - a.weight);

  let largestCompany = 0;
  let top5Companies = 0;
  let unknownLookThrough = 0;
  let topCompanies: CompanyExposure[] = [];

  if (positions && positions.length > 0) {
    const { companies, unknownWeight } = computeLookThrough(positions, total);
    topCompanies = companies.slice(0, 8);
    largestCompany = (companies[0]?.weight ?? 0) * 100;
    top5Companies = companies.slice(0, 5).reduce((s, c) => s + c.weight, 0) * 100;
    unknownLookThrough = unknownWeight * 100;
  } else {
    // Sem dados de holdings disponíveis: recai na concentração por posição
    // direta (sem look-through) — subestima a diversificação real de
    // carteiras com ETFs, por isso o valor deve ser lido com essa reserva.
    const vals = open.map((a) => assetCurrentValue(a)).sort((a, b) => b - a);
    largestCompany = total ? ((vals[0] ?? 0) / total) * 100 : 0;
    top5Companies = total ? (vals.slice(0, 5).reduce((s, v) => s + v, 0) / total) * 100 : 0;
  }

  const metrics = {
    largestCompany,
    top5Companies,
    unknownLookThrough,
    topSector: exposure?.concentration.topSector || 0,
    topCountry: exposure?.concentration.topCountry || 0,
    topCurrency: exposure?.concentration.topCurrency || 0,
    coverage: exposure?.coverage ?? 0,
  };

  const risks: string[] = [];
  const recommendations: string[] = [];
  if (open.length === 0) risks.push("Carteira sem posições abertas.");
  if (metrics.largestCompany > 10)
    risks.push(
      `Exposição a uma única empresa (contando o peso dela dentro dos ETFs) acima de 10% (${metrics.largestCompany.toFixed(1)}%).`,
    );
  if (metrics.top5Companies > 30)
    risks.push(
      `As 5 maiores exposições a empresas somam ${metrics.top5Companies.toFixed(1)}% da carteira.`,
    );
  if (positions && positions.length > 0 && metrics.unknownLookThrough > 40)
    risks.push(
      `${metrics.unknownLookThrough.toFixed(1)}% da carteira está em ETFs sem composição suficientemente conhecida — a concentração real pode estar subestimada.`,
    );
  if (metrics.topSector > 40)
    risks.push(`Setor dominante acima de 40% (${metrics.topSector.toFixed(1)}%).`);
  if (metrics.topCountry > 50)
    risks.push(`País dominante acima de 50% (${metrics.topCountry.toFixed(1)}%).`);
  if (metrics.topCurrency > 70)
    risks.push(`Moeda dominante acima de 70% (${metrics.topCurrency.toFixed(1)}%).`);
  if (exposure && metrics.coverage < 99)
    risks.push(`Dados de exposição incompletos: cobertura de ${metrics.coverage.toFixed(1)}%.`);
  if (risks.length === 0)
    recommendations.push(
      "Não foi detetado um risco de concentração material pelos limites definidos.",
    );
  if (metrics.largestCompany > 10)
    recommendations.push(
      topCompanies[0]
        ? `Evitar reforçar ${topCompanies[0].label} (direto + dentro dos ETFs) até o peso relativo diminuir.`
        : "Evitar reforçar a maior posição até o peso relativo diminuir.",
    );
  if (positions && positions.length > 0 && metrics.unknownLookThrough > 40)
    recommendations.push(
      "Atualizar a composição dos ETFs com cobertura baixa para confirmar a concentração real por empresa.",
    );
  if (metrics.topSector > 40 || metrics.topCountry > 50)
    recommendations.push("Privilegiar novos aportes que reduzam a concentração económica.");
  if (exposure && metrics.coverage < 99)
    recommendations.push(
      "Interpretar as recomendações de concentração com cautela e atualizar os dados de exposição.",
    );

  const coveragePenalty = exposure ? Math.max(0, 99 - metrics.coverage) * 0.12 : 0;
  const score = Math.max(
    0,
    Math.min(
      100,
      100 -
        risks.length * 12 -
        Math.max(0, metrics.largestCompany - 10) * 0.8 -
        Math.max(0, metrics.top5Companies - 30) * 0.3 -
        coveragePenalty,
    ),
  );
  return { score, risks, recommendations, metrics, instrumentMix, topCompanies };
}
