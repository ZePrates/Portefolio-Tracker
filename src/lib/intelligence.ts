import type { Asset } from "@/lib/portfolio-types";
import { assetCurrentValue, isOpenPosition } from "@/lib/portfolio-types";
import type { ExposureReport } from "@/lib/exposure";
export interface Intelligence {
  score: number;
  risks: string[];
  recommendations: string[];
  metrics: {
    largestAsset: number;
    largestClass: number;
    top5: number;
    topSector: number;
    topCountry: number;
    topCurrency: number;
    coverage: number;
  };
}
export function portfolioIntelligence(assets: Asset[], exposure?: ExposureReport): Intelligence {
  const open = assets.filter(isOpenPosition),
    total = open.reduce((s, a) => s + assetCurrentValue(a), 0);
  const vals = open.map((a) => assetCurrentValue(a)).sort((a, b) => b - a);
  const largest = total ? ((vals[0] ?? 0) / total) * 100 : 0;
  const classVals = new Map<string, number>();
  for (const a of open)
    classVals.set(a.class, (classVals.get(a.class) || 0) + assetCurrentValue(a));
  const largestClass = total ? (Math.max(0, ...classVals.values()) / total) * 100 : 0;
  const top5 = total ? (vals.slice(0, 5).reduce((s, v) => s + v, 0) / total) * 100 : 0;
  const metrics = {
    largestAsset: exposure?.concentration.largest || largest,
    largestClass,
    top5: exposure?.concentration.top5 || top5,
    topSector: exposure?.concentration.topSector || 0,
    topCountry: exposure?.concentration.topCountry || 0,
    topCurrency: exposure?.concentration.topCurrency || 0,
    coverage: exposure?.coverage ?? 0,
  };
  const risks: string[] = [];
  const recommendations: string[] = [];
  if (open.length === 0) risks.push("Carteira sem posições abertas.");
  if (metrics.largestAsset > 25)
    risks.push(`Maior exposição económica acima de 25% (${metrics.largestAsset.toFixed(1)}%).`);
  if (largestClass > 40)
    risks.push(`Uma classe representa ${largestClass.toFixed(1)}% da carteira.`);
  if (metrics.top5 > 70)
    risks.push(`As 5 maiores exposições representam ${metrics.top5.toFixed(1)}%.`);
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
  if (metrics.largestAsset > 25)
    recommendations.push("Evitar reforçar a maior posição até o peso relativo diminuir.");
  if (largestClass > 40)
    recommendations.push(
      "Direcionar novos aportes para classes sub-representadas, se compatível com a estratégia.",
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
        Math.max(0, metrics.largestAsset - 25) * 0.5 -
        Math.max(0, largestClass - 40) * 0.4 -
        coveragePenalty,
    ),
  );
  return { score, risks, recommendations, metrics };
}
