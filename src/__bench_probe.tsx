// Sonda temporária: monta o cartão de comparação com dados sintéticos para
// verificação visual. Apagar depois da verificação.
import { createRoot } from "react-dom/client";
import { BenchmarkCard } from "@/components/benchmark-card";
import type { BenchmarkComparison } from "@/lib/benchmark";

function build(): BenchmarkComparison {
  const series = [];
  let invested = 0;
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(2025, i, 28));
    const iso = d.toISOString().slice(0, 10);
    invested += 1000;
    const years = (i + 1) / 12;
    const benchmark = invested * Math.pow(1.1056, years);
    const portfolio = benchmark * (1 + 0.06 + i * 0.004);
    series.push({ date: iso, invested, benchmark, portfolio });
  }
  const last = series[series.length - 1];
  return {
    annualReturnPct: 10.56,
    portfolio: Math.round(last.portfolio + 900),
    portfolioValue: Math.round(last.portfolio),
    dividends: 900,
    benchmark: Math.round(last.benchmark),
    invested: last.invested,
    difference: Math.round(last.portfolio + 900 - last.benchmark),
    differencePct: 12.4,
    firstDate: series[0].date,
    series,
  };
}

export function mountBench(el: HTMLElement) {
  createRoot(el).render(
    <BenchmarkCard
      comparison={build()}
      scope="total"
      onScopeChange={() => {}}
      hidden={false}
    />,
  );
}
