import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { analyzeCompany } from "@/lib/valuation/analyze";
import { makeCompany, makeStatements } from "@/lib/valuation/test-utils";
import type { CompanyData } from "@/lib/valuation/types";
import { ValuationHeader } from "@/components/valuation/valuation-header";
import { ValuationSummary } from "@/components/valuation/valuation-summary";
import { ValuationFairValue } from "@/components/valuation/valuation-fair-value";
import { ValuationHealth } from "@/components/valuation/valuation-health";
import { ValuationManagement } from "@/components/valuation/valuation-management";
import { ValuationReit } from "@/components/valuation/valuation-reit";
import { ValuationMacro } from "@/components/valuation/valuation-macro";
import { ValuationNews, ValuationStatements } from "@/components/valuation/valuation-statements";

function renderAll(data: CompanyData): string {
  const a = analyzeCompany(data);
  return renderToStaticMarkup(
    <>
      <ValuationHeader data={data} analysis={a} onRefresh={() => {}} refreshing={false} />
      <ValuationSummary data={data} analysis={a} />
      <ValuationFairValue data={data} analysis={a} overrides={{}} onOverrides={() => {}} />
      <ValuationHealth data={data} analysis={a} />
      <ValuationManagement data={data} analysis={a} />
      <ValuationReit data={data} analysis={a} />
      <ValuationMacro data={data} analysis={a} />
      <ValuationStatements data={data} />
      <ValuationNews data={data} />
    </>,
  );
}

describe("página de avaliação (renderização)", () => {
  it("empresa madura: todos os separadores com os cálculos explicados", () => {
    const html = renderAll(makeCompany());
    for (const text of [
      "Empresa Teste",
      "Valor justo ponderado",
      "DCF: fluxos de caixa descontados",
      "O que o preço atual assume",
      "Sensibilidade: WACC × crescimento perpétuo",
      "Monte Carlo",
      "Múltiplos dos pares",
      "Altman Z-Score",
      "Piotroski F-Score",
      "Equilíbrio com margem de segurança",
      "FED Model",
      "Modelo de Yardeni",
      "Demonstração de resultados",
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });

  it("REIT: separador próprio com FFO, NAV e nota", () => {
    const data = makeCompany({
      statements: makeStatements({
        depreciation: [180, 190, 195, 200],
        netIncome: [80, 90, 95, 100],
      }),
    });
    data.profile = { ...data.profile, sector: "Real Estate", industry: "REIT - Industrial" };
    const html = renderAll(data);
    expect(html).toContain("P/FFO e P/AFFO");
    expect(html).toContain("Valor dos imóveis (NAV)");
    expect(html).toContain("Nota REIT");
    expect(html).not.toContain("NaN");
  });

  it("banco: custo do capital próprio e P/VC justificado, sem DCF", () => {
    const data = makeCompany();
    data.profile = { ...data.profile, sector: "Financial Services", industry: "Banks - Regional" };
    const html = renderAll(data);
    expect(html).toContain("Banco: valor pelo capital próprio");
    expect(html).toContain("Custo do capital próprio");
    expect(html).not.toContain("DCF: fluxos de caixa descontados");
    expect(html).not.toContain("NaN");
  });
});
