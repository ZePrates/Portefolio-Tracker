import { describe, expect, it } from "vitest";
import { analyzeCompany } from "@/lib/valuation/analyze";
import { classifyCompany } from "@/lib/valuation/classify";
import { makeCompany, makeStatements } from "@/lib/valuation/test-utils";

describe("tipo de empresa", () => {
  it("madura, REIT, banco, crescimento e cíclica", () => {
    expect(classifyCompany(makeCompany()).type).toBe("madura");
    const reit = makeCompany();
    reit.profile = { ...reit.profile, sector: "Real Estate", industry: "REIT - Industrial" };
    expect(classifyCompany(reit).type).toBe("reit");
    const bank = makeCompany();
    bank.profile = { ...bank.profile, sector: "Financial Services", industry: "Banks - Regional" };
    expect(classifyCompany(bank).type).toBe("financeira");
    const growth = makeCompany({ statements: makeStatements({ revenue: [100, 130, 169, 219.7] }) });
    expect(classifyCompany(growth).type).toBe("crescimento");
    const cyc = makeCompany();
    cyc.profile = { ...cyc.profile, sector: "Energy", industry: "Oil & Gas Integrated" };
    expect(classifyCompany(cyc).type).toBe("ciclica");
  });

  it("redes de pagamento (Credit Services com contas operacionais) não são bancos", () => {
    const visa = makeCompany();
    visa.profile = { ...visa.profile, sector: "Financial Services", industry: "Credit Services" };
    expect(classifyCompany(visa).type).toBe("madura");
    // Sem resultado operacional nem ativo corrente (estrutura de banco): financeira.
    const lender = makeCompany({
      statements: makeStatements({
        operatingIncome: [null, null, null, null],
        currentAssets: [null, null, null, null],
      }),
    });
    lender.profile = {
      ...lender.profile,
      sector: "Financial Services",
      industry: "Credit Services",
    };
    expect(classifyCompany(lender).type).toBe("financeira");
  });
});

describe("avaliação completa", () => {
  const data = makeCompany();
  const r = analyzeCompany(data);

  it("pondera os modelos e os pesos somam 1", () => {
    const used = r.composite.models.filter((m) => m.included);
    expect(used.length).toBeGreaterThanOrEqual(3);
    expect(used.reduce((s, m) => s + m.weight, 0)).toBeCloseTo(1, 10);
    expect(r.composite.fairValue!).toBeGreaterThanOrEqual(r.composite.low!);
    expect(r.composite.fairValue!).toBeLessThanOrEqual(r.composite.high!);
    expect(r.composite.verdict).not.toBeNull();
    expect(r.composite.upside).toBeCloseTo(r.composite.fairValue! / 30 - 1, 10);
  });

  it("os modelos que não se aplicam ficam de fora com o motivo", () => {
    const pvc = r.composite.models.find((m) => m.key === "pvc")!;
    expect(pvc.included).toBe(false);
    expect(pvc.reason).toBeTruthy();
    expect(r.dcf.applicable).toBe(true);
    expect(r.dcf.value!).toBeGreaterThan(0);
    expect(r.dcf.sensitivity).not.toBeNull();
    expect(r.dcf.monteCarlo).not.toBeNull();
    expect(r.ddm.applicable).toBe(true);
  });

  it("os pressupostos podem ser alterados e o valor muda", () => {
    const faster = analyzeCompany(data, { growth: 0.2 });
    expect(faster.dcf.value!).toBeGreaterThan(r.dcf.value!);
    expect(faster.assumptions.growth).toBe(0.2);
    expect(faster.defaults.growth).toBe(r.assumptions.growth);
  });

  it("nota global entre 0 e 100", () => {
    expect(r.score.total).not.toBeNull();
    expect(r.score.total!).toBeGreaterThanOrEqual(0);
    expect(r.score.total!).toBeLessThanOrEqual(100);
    expect(r.health.score.score).not.toBeNull();
    expect(r.management.score.score).not.toBeNull();
  });

  it("um banco usa o capital próprio e não o DCF", () => {
    const bank = makeCompany();
    bank.profile = { ...bank.profile, sector: "Financial Services", industry: "Banks - Regional" };
    const b = analyzeCompany(bank);
    expect(b.dcf.applicable).toBe(false);
    expect(b.composite.models.find((m) => m.key === "dcf")!.included).toBe(false);
    expect(b.composite.models.find((m) => m.key === "pvc")!.included).toBe(true);
    expect(b.health.altmanApplicable).toBe(false);
  });

  it("o EVA fica de fora quando o capital investido é pequeno face ao valor de mercado", () => {
    const pricey = makeCompany();
    pricey.market = { ...pricey.market, marketCap: 30000, price: 300 };
    const p = analyzeCompany(pricey);
    const eva = p.composite.models.find((m) => m.key === "eva")!;
    expect(eva.included).toBe(false);
    expect(eva.reason).toMatch(/intangíveis/);
  });

  it("assinala contas noutra moeda e empresas que queimam caixa", () => {
    const fx = makeCompany();
    fx.profile = { ...fx.profile, financialCurrency: "TWD" };
    expect(analyzeCompany(fx).flags.some((f) => f.kind === "moeda")).toBe(true);
    const burn = makeCompany({
      statements: makeStatements({
        operatingIncome: [-50, -60, -70, -80],
        freeCashFlow: [-100, -120, -150, -200],
        cash: [300, 250, 200, 150],
      }),
    });
    expect(analyzeCompany(burn).flags.some((f) => f.kind === "especulativa")).toBe(true);
  });

  it("avisa quando os modelos discordam muito ou ficam muito acima dos analistas", () => {
    // Analistas muito abaixo dos modelos e do preço: possível armadilha de valor.
    const skeptical = makeCompany();
    skeptical.analysts = { ...skeptical.analysts, targetMean: 10, count: 12 };
    skeptical.market = { ...skeptical.market, price: 12, marketCap: 1200 };
    const r = analyzeCompany(skeptical);
    const f = r.flags.find((x) => x.kind === "analistas")!;
    expect(f.severity).toBe("aviso");
    expect(f.text).toMatch(/acima do alvo médio de 12 analistas/);
    // O potencial deixa de contar como positivo na nota.
    expect(r.composite.reliable).toBe(false);
    expect(r.score.parts.find((p) => p.label === "Valorização")!.value).toBeCloseTo(50, 8);
    expect(analyzeCompany(makeCompany()).composite.reliable).toBe(true);
    // Modelos com valores muito diferentes (EVA forçado muito acima dos restantes).
    const r2 = analyzeCompany(makeCompany(), { growth: 0.35, targetMargin: 0.55 });
    const vals = r2.composite.models.filter((m) => m.included).map((m) => m.value!);
    const disagree = Math.max(...vals) / Math.min(...vals) > 3;
    expect(r2.flags.some((x) => x.kind === "discordantes")).toBe(disagree);
  });

  it("avisa da armadilha de valor depois de uma grande queda", () => {
    const fallen = makeCompany();
    // Preço caiu de 30 para 12 num ano; as contas ainda são as de antes.
    fallen.priceHistory = fallen.priceHistory.map((p, i, arr) => ({
      ...p,
      close: 30 - (18 * i) / (arr.length - 1),
    }));
    fallen.market = { ...fallen.market, price: 12, marketCap: 1200 };
    const r = analyzeCompany(fallen);
    expect(r.composite.upside!).toBeGreaterThan(0.5);
    expect(r.flags.some((f) => f.kind === "armadilha")).toBe(true);
    expect(analyzeCompany(makeCompany()).flags.some((f) => f.kind === "armadilha")).toBe(false);
  });
});
