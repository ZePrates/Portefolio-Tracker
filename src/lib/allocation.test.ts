import { describe, expect, it } from "vitest";
import { allocationDrift, contributionPlan } from "./allocation";

const slices = [
  { key: "etf", label: "ETFs", value: 7000 },
  { key: "reit", label: "REITs", value: 2000 },
  { key: "acao_dividendo", label: "Ações Dividendos", value: 1000 },
];
const targets = [
  { key: "etf", targetPct: 80 },
  { key: "reit", targetPct: 10 },
  { key: "acao_dividendo", targetPct: 10 },
];

describe("allocationDrift", () => {
  it("calcula desvios em pontos percentuais e em EUR", () => {
    const r = allocationDrift(slices, targets);
    expect(r.total).toBe(10000);
    expect(r.targetSum).toBe(100);
    const etf = r.rows.find((x) => x.key === "etf")!;
    expect(etf.currentPct).toBeCloseTo(70);
    expect(etf.driftPct).toBeCloseTo(-10);
    expect(etf.driftValue).toBe(-1000);
    expect(r.rows.find((x) => x.key === "reit")!.driftValue).toBe(1000);
    expect(r.maxAbsDrift).toBeCloseTo(10);
  });

  it("inclui classes sem alvo (alvo 0) e alvos sem posição", () => {
    const r = allocationDrift(slices, [
      { key: "etf", targetPct: 90 },
      { key: "metal", targetPct: 10 },
    ]);
    expect(r.rows.find((x) => x.key === "reit")!.targetPct).toBe(0);
    expect(r.rows.find((x) => x.key === "metal")!.value).toBe(0);
  });

  it("normaliza alvos que não somam 100", () => {
    const r = allocationDrift(slices, [
      { key: "etf", targetPct: 40 },
      { key: "reit", targetPct: 10 },
    ]);
    expect(r.rows.find((x) => x.key === "etf")!.targetPct).toBeCloseTo(80);
    expect(r.targetSum).toBe(50);
  });
});

describe("contributionPlan (sem vender)", () => {
  it("aporte menor que o défice vai só para o que está abaixo do alvo, proporcionalmente", () => {
    // Total após aporte 10500 → défices: ETF 8400−7000 = 1400; Ações 1050−1000 = 50; REIT acima.
    const plan = contributionPlan(slices, targets, 500);
    expect(plan).toEqual([
      { key: "etf", label: "ETFs", amount: 482.76 },
      { key: "acao_dividendo", label: "Ações Dividendos", amount: 17.24 },
    ]);
  });

  it("aporte maior que os défices: tapa défices e reparte o resto pelos alvos", () => {
    const plan = contributionPlan(slices, targets, 10000);
    const sum = plan.reduce((s, p) => s + p.amount, 0);
    expect(sum).toBeCloseTo(10000, 2);
    // total 20000 → ETF 16000 (+9000), Ações 2000 (+1000), REIT 2000 (0)
    expect(plan.find((p) => p.key === "etf")!.amount).toBeCloseTo(9000);
    expect(plan.find((p) => p.key === "acao_dividendo")!.amount).toBeCloseTo(1000);
    expect(plan.find((p) => p.key === "reit")).toBeUndefined();
  });

  it("a soma bate sempre ao cêntimo", () => {
    const plan = contributionPlan(slices, targets, 333.33);
    expect(Math.round(plan.reduce((s, p) => s + p.amount, 0) * 100)).toBe(33333);
  });

  it("sem alvos ou sem aporte não sugere nada", () => {
    expect(contributionPlan(slices, [], 100)).toEqual([]);
    expect(contributionPlan(slices, targets, 0)).toEqual([]);
  });
});
