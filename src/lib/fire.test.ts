import { describe, expect, it } from "vitest";
import { fireDetails, fireProgress, type FireSettings } from "./fire";

const settings: FireSettings = {
  annualExpenses: 24000,
  safeWithdrawalRate: 4,
  monthlyContribution: 1000,
  expectedReturnPct: 7,
  inflationPct: 2,
};

describe("fireProgress", () => {
  it("número FIRE = despesas ÷ taxa de levantamento (regra dos 25×)", () => {
    const p = fireProgress(settings, 150000, 3000, "2026-10-07");
    expect(p.fireNumber).toBe(600000);
    expect(p.progressPct).toBeCloseTo(25);
    expect(p.remaining).toBe(450000);
    expect(p.passiveCoveragePct).toBeCloseTo(12.5);
  });

  it("usa o retorno real (nominal descontado da inflação)", () => {
    const p = fireProgress(settings, 150000, 0, "2026-10-07");
    expect(p.realReturnPct).toBeCloseTo((1.07 / 1.02 - 1) * 100, 6);
  });

  it("estima anos e mês até ao FIRE", () => {
    const p = fireProgress(settings, 150000, 0, "2026-10-07");
    // Controlo anual: 150k × 1,049^16 + 12k × (1,049^16 − 1)/0,049 ≈ 604k → ~16 anos
    expect(p.yearsToFire).toBeGreaterThan(15);
    expect(p.yearsToFire).toBeLessThan(17);
    expect(p.fireMonth).toMatch(/^204[1-3]-\d{2}$/);
  });

  it("já atingido → 0 anos; inatingível → null", () => {
    expect(fireProgress(settings, 700000, 0, "2026-10-07").yearsToFire).toBe(0);
    expect(
      fireProgress(
        { ...settings, monthlyContribution: 0, expectedReturnPct: 0, inflationPct: 2 },
        1000,
        0,
        "2026-10-07",
      ).yearsToFire,
    ).toBeNull();
  });
});

describe("fireDetails", () => {
  it("patamares são múltiplos do número FIRE, com progresso e datas", () => {
    const d = fireDetails(settings, 350000, 350000, "2026-10-07");
    expect(d.levels.map((l) => l.key)).toEqual(["half", "lean", "fire", "fat"]);
    const [half, lean, fire, fat] = d.levels;
    expect(half!.target).toBe(300000);
    expect(half!.reached).toBe(true);
    expect(half!.years).toBe(0);
    expect(lean!.target).toBeCloseTo(420000);
    expect(lean!.progressPct).toBeCloseTo((350000 / 420000) * 100);
    expect(fire!.years).toBe(fireProgress(settings, 350000, 0, "2026-10-07").yearsToFire);
    expect(fat!.target).toBe(900000);
    expect(fat!.years!).toBeGreaterThan(fire!.years!);
  });

  it("Coast FIRE: data sem mais aportes é mais tarde que com aportes", () => {
    const d = fireDetails(settings, 150000, 150000, "2026-10-07");
    const withContrib = fireProgress(settings, 150000, 0, "2026-10-07").yearsToFire!;
    // 150k × 1,049^n = 600k → n ≈ 29 anos
    expect(d.coast.years!).toBeGreaterThan(withContrib);
    expect(d.coast.years!).toBeGreaterThan(28);
    expect(d.coast.years!).toBeLessThan(30);
    const flat = fireDetails(
      { ...settings, expectedReturnPct: 2, inflationPct: 2 },
      150000,
      150000,
      "2026-10-07",
    );
    expect(flat.coast.years).toBeNull();
  });

  it("sem mais-valias o imposto não muda nada", () => {
    const d = fireDetails(settings, 700000, 700000, "2026-10-07", 0.28);
    expect(d.tax!.gainSharePct).toBe(0);
    expect(d.tax!.fireNumber).toBeCloseTo(600000);
    expect(d.tax!.yearsToFire).toBe(0);
  });

  it("com mais-valias é preciso mais capital bruto e mais tempo", () => {
    // 650k de valor, 325k de custo → 50 % é mais-valia → imposto efetivo 14 %.
    const d = fireDetails(settings, 650000, 325000, "2026-10-07", 0.28);
    expect(d.tax!.gainSharePct).toBeCloseTo(50);
    expect(d.tax!.effectiveRatePct).toBeCloseTo(14);
    // Hoje: 650k × 4 % × 0,86 = 22 360 < 24 000 → ainda não.
    expect(d.tax!.yearsToFire!).toBeGreaterThan(0);
    expect(d.tax!.fireNumber).toBeGreaterThan(600000);
    expect(d.tax!.fireNumber).toBeLessThan(600000 / (1 - 0.28));
  });

  it("taxa inválida → sem cálculo de impostos", () => {
    expect(fireDetails(settings, 1000, 1000, "2026-10-07", 0).tax).toBeNull();
  });

  it("cenários: mais retorno chega mais cedo; o teu coincide com a previsão", () => {
    const d = fireDetails(settings, 150000, 150000, "2026-10-07");
    expect(d.scenarios.map((s) => s.key)).toEqual(["prudent", "historical", "optimistic", "yours"]);
    const [prudent, historical, optimistic, yours] = d.scenarios;
    expect(prudent!.years!).toBeGreaterThan(historical!.years!);
    expect(historical!.years!).toBeGreaterThan(optimistic!.years!);
    expect(historical!.nominalReturnPct).toBeCloseTo(7.1);
    expect(yours!.years).toBe(fireProgress(settings, 150000, 0, "2026-10-07").yearsToFire);
    expect(d.optimistic).toBe(false);
  });

  it("assinala um retorno acima do cenário otimista", () => {
    const d = fireDetails(
      { ...settings, expectedReturnPct: 15, inflationPct: 3 },
      150000,
      150000,
      "2026-10-07",
    );
    expect(d.optimistic).toBe(true);
    expect(d.scenarios.at(-1)!.realReturnPct).toBeCloseTo(11.65, 1);
  });
});
