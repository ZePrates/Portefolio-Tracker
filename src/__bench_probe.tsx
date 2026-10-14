// Sonda temporária para verificação visual. Apagar depois.
import { createRoot } from "react-dom/client";
import { BenchmarkCard } from "@/components/benchmark-card";
import type { BenchmarkComparison, BenchmarkPoint } from "@/lib/benchmark";

function build(): BenchmarkComparison {
  const series: BenchmarkPoint[] = [];
  let invested = 0;
  let lastPortfolio = 0;
  let lastBenchmark = 0;
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(2025, i, 28));
    invested += 1000;
    const years = (i + 1) / 12;
    lastBenchmark = invested * Math.pow(1.1056, years);
    lastPortfolio = lastBenchmark * (1 + 0.06 + i * 0.004);
    series.push({ date: d.toISOString().slice(0, 10), invested, benchmark: lastBenchmark, portfolio: lastPortfolio });
  }
  return {
    annualReturnPct: 10.56,
    portfolio: Math.round(lastPortfolio + 900),
    portfolioValue: Math.round(lastPortfolio),
    dividends: 900,
    benchmark: Math.round(lastBenchmark),
    invested,
    difference: Math.round(lastPortfolio + 900 - lastBenchmark),
    differencePct: 12.4,
    firstDate: series[0]?.date ?? "2025-01-28",
    series,
  };
}

export function mountBench(el: HTMLElement) {
  createRoot(el).render(
    <BenchmarkCard comparison={build()} scope="total" onScopeChange={() => {}} hidden={false} />,
  );
}
