import { describe, expect, it } from "vitest";
import {
  altman,
  beneish,
  dupont,
  financialBalance,
  piotroskiAt,
  qualityMetrics,
} from "@/lib/valuation/health";
import { analyzeReit, reitScore } from "@/lib/valuation/reit";
import { makeStatements } from "@/lib/valuation/test-utils";

describe("Altman Z-Score", () => {
  it("calcula os dois modelos e escolhe o original na indústria", () => {
    const r = altman(makeStatements(), 3000, true)!;
    expect(r.model).toBe("original");
    expect(r.x1).toBeCloseTo(270 / 1260, 10);
    expect(r.x4).toBeCloseTo(3000 / 560, 10);
    expect(r.score).toBeCloseTo(5.429816, 5);
    expect(r.z2).toBeCloseTo(5.147652, 5);
    expect(r.zone).toBe("segura");
  });

  it("usa o Z'' nos serviços e classifica as zonas", () => {
    const weak = makeStatements({
      currentAssets: [400, 430, 465, 200],
      retainedEarnings: [300, 360, 426, -400],
      operatingIncome: [160, 176, 193.6, -20],
      equity: [500, 560, 626, 100],
      totalLiabilities: [500, 520, 540, 1160],
    });
    const r = altman(weak, 300, false)!;
    expect(r.model).toBe("z2");
    expect(r.zone).toBe("perigo");
  });
});

describe("Piotroski F-Score", () => {
  it("9 em 9 quando todos os critérios melhoram", () => {
    const s = makeStatements({ grossProfit: [320, 352, 387.2, 440] });
    const r = piotroskiAt(s, 3)!;
    expect(r.available).toBe(9);
    expect(r.score).toBe(9);
    expect(r.criteria.every((c) => c.pass)).toBe(true);
  });

  it("emitir ações e piorar a margem tira pontos", () => {
    const s = makeStatements({
      grossProfit: [320, 352, 387.2, 400],
      sharesOutstanding: [100, 100, 100, 110],
    });
    const r = piotroskiAt(s, 3)!;
    expect(r.criteria.find((c) => c.id === "shares")!.pass).toBe(false);
    expect(r.criteria.find((c) => c.id === "margin")!.pass).toBe(false);
    expect(r.score).toBe(7);
  });
});

describe("Beneish M-Score", () => {
  it("empresa sem sinais de manipulação", () => {
    const r = beneish(makeStatements())!;
    expect(r.score).toBeCloseTo(-2.6079, 3);
    expect(r.flagged).toBe(false);
    expect(r.missing).toEqual([]);
  });

  it("clientes a disparar e lucro sem caixa levantam o alerta", () => {
    const r = beneish(
      makeStatements({
        receivables: [120, 130, 140, 400],
        operatingCashFlow: [170, 185, 200, -50],
        revenue: [800, 880, 968, 1500],
      }),
    )!;
    expect(r.flagged).toBe(true);
  });
});

describe("rácios e equilíbrio financeiro", () => {
  it("DuPont reconstrói o ROE", () => {
    const d = dupont(makeStatements());
    expect(d.roe).toBeCloseTo(160.3384 / 700, 10);
    expect(d.taxBurden! * d.interestBurden! * d.ebitMargin!).toBeCloseTo(d.netMargin!, 10);
  });

  it("rácios de liquidez, dívida e conversão em caixa", () => {
    const q = qualityMetrics(makeStatements());
    expect(q.currentRatio).toBeCloseTo(500 / 230, 10);
    expect(q.netDebt).toBe(70);
    expect(q.netDebtToEbitda).toBeCloseTo(70 / 266.2, 10);
    expect(q.interestCoverage).toBeCloseTo(21.296, 6);
    expect(q.cashConversion).toBeCloseTo(220 / 160.3384, 8);
    expect(q.revenueCagr).toBeCloseTo(0.1, 8);
    expect(q.shareChange).toBe(0);
  });

  it("classifica o equilíbrio pela tesouraria líquida (método direto)", () => {
    const base = makeStatements();
    const r = financialBalance(base)!;
    // FM = 500 − 230 = 270; TL = 130 − 20 = 110; NFM = 160
    expect(r.method).toBe("direto");
    expect(r.netTreasury).toBe(110);
    expect(r.workingCapitalNeeds).toBe(160);
    expect(r.state).toBe("equilibrio_margem");
    const withLast = (ca: number, cl: number, cash: number, debt: number) =>
      financialBalance({
        ...base,
        currentAssets: [...base.currentAssets.slice(0, 3), ca],
        currentLiabilities: [...base.currentLiabilities.slice(0, 3), cl],
        cash: [...base.cash.slice(0, 3), cash],
        currentDebt: [...base.currentDebt.slice(0, 3), debt],
      })!.state;
    expect(withLast(100, 200, 150, 0)).toBe("grande_distribuicao");
    expect(withLast(300, 250, 20, 100)).toBe("dependencia_bancaria");
    expect(withLast(100, 200, 20, 120)).toBe("desequilibrio");
  });

  it("receitas diferidas no passivo corrente não contam como dívida bancária", () => {
    // Muito passivo corrente (adiantamentos de clientes), mas caixa acima da dívida de curto prazo.
    const base = makeStatements();
    const r = financialBalance({
      ...base,
      currentLiabilities: [...base.currentLiabilities.slice(0, 3), 480],
      cash: [...base.cash.slice(0, 3), 300],
      currentDebt: [...base.currentDebt.slice(0, 3), 10],
    })!;
    expect(r.netTreasury).toBe(290);
    expect(r.state).toBe("equilibrio_margem");
  });

  it("sem dívida de curto prazo aproxima a NFM pelo ciclo de exploração", () => {
    const base = makeStatements();
    const r = financialBalance({ ...base, currentDebt: [null, null, null, null] })!;
    expect(r.method).toBe("aproximado");
    expect(r.workingCapitalNeeds).toBe(150 + 115 - 95);
  });
});

describe("REIT", () => {
  const s = makeStatements({
    netIncome: [80, 90, 95, 100],
    depreciation: [180, 190, 195, 200],
    gainOnSale: [0, 0, 0, 20],
    ebitda: [360, 380, 390, 400],
    totalDebt: [2000, 2000, 2000, 2000],
    cash: [100, 100, 100, 100],
    interestExpense: [80, 80, 80, 80],
    operatingCashFlow: [260, 270, 280, 300],
  });
  const r = analyzeReit({
    statements: s,
    price: 40,
    shares: 100,
    marketCap: 4000,
    dividendRate: 2,
    capRate: 0.06,
    pAffoTarget: 15,
    maintenanceCapexPct: 0.1,
    forwardGrowth: null,
  });

  it("FFO, AFFO, payout e NAV", () => {
    expect(r.ffo).toBe(280);
    expect(r.affo).toBe(260);
    expect(r.affoSource).toBe("ffo");
    expect(r.affoFromCash).toBe(280);
    expect(r.pAffo).toBeCloseTo(40 / 2.6, 8);
    expect(r.affoPayout).toBeCloseTo(200 / 260, 8);
    expect(r.netDebtToEbitda).toBeCloseTo(4.75, 8);
    expect(r.navPerShare).toBeCloseTo((400 / 0.06 - 1900) / 100, 6);
    expect(r.premiumToNav!).toBeLessThan(0);
    expect(r.affoValue).toBeCloseTo(39, 8);
  });

  it("nota de 0 a 10", () => {
    const sc = reitScore(r, 0.1);
    expect(sc.score).not.toBeNull();
    expect(sc.score!).toBeGreaterThan(5);
    expect(sc.score!).toBeLessThanOrEqual(10);
  });

  it("imparidades voltam ao FFO, o NOI usa o EBITDA normalizado e o valor olha para o ano em curso", () => {
    // Ano com 300 de imparidades: prejuízo de 200 e EBITDA reportado deprimido.
    const hit = makeStatements({
      netIncome: [80, 90, 95, -200],
      depreciation: [180, 190, 195, 200],
      impairments: [0, 0, 0, 300],
      gainOnSale: [0, 0, 0, 0],
      ebitda: [360, 380, 390, 100],
      normalizedEbitda: [360, 380, 390, 400],
      totalDebt: [2000, 2000, 2000, 2000],
      cash: [100, 100, 100, 100],
    });
    const base = {
      statements: hit,
      price: 20,
      shares: 100,
      marketCap: 2000,
      dividendRate: 1,
      capRate: 0.06,
      pAffoTarget: 15,
      maintenanceCapexPct: 0.1,
    };
    const now = analyzeReit({ ...base, forwardGrowth: null });
    expect(now.ffo).toBe(300); // −200 + 200 + 300
    expect(now.noi).toBe(400);
    expect(now.netDebtToEbitda).toBeCloseTo(1900 / 400, 10);
    const falling = analyzeReit({ ...base, forwardGrowth: -0.1 });
    expect(falling.forwardFactor).toBeCloseTo(0.9, 10);
    expect(falling.affoValue).toBeCloseTo(now.affoValue! * 0.9, 8);
    expect(falling.navPerShare!).toBeLessThan(now.navPerShare!);
    // O ajuste fica limitado a −30 %.
    expect(analyzeReit({ ...base, forwardGrowth: -0.8 }).forwardFactor).toBeCloseTo(0.7, 10);
  });

  it("o AFFO fica pelo fluxo de caixa quando este é mais baixo do que o FFO sugere", () => {
    // Imparidades de 300 (parte em investimentos que não são imóveis) inflacionam o FFO.
    const hit = makeStatements({
      netIncome: [80, 90, 95, -200],
      depreciation: [180, 190, 195, 200],
      impairments: [0, 0, 0, 300],
      gainOnSale: [0, 0, 0, 0],
      operatingCashFlow: [250, 260, 255, 180],
    });
    const base = {
      statements: hit,
      price: 20,
      shares: 100,
      marketCap: 2000,
      dividendRate: 1,
      capRate: 0.06,
      pAffoTarget: 15,
      maintenanceCapexPct: 0.1,
      forwardGrowth: null,
    };
    const r = analyzeReit(base);
    expect(r.affoFromFfo).toBe(280); // 300 − 20
    expect(r.affoFromCash).toBe(160); // 180 − 20
    expect(r.affoSource).toBe("caixa");
    expect(r.affo).toBe(160);
    expect(r.affoPayout).toBeCloseTo(100 / 160, 10);
    expect(r.affoValue).toBeCloseTo(1.6 * 15, 10);
    // Sem caixa operacional (ou negativa) fica o AFFO pelo FFO.
    const noCash = analyzeReit({
      ...base,
      statements: { ...hit, operatingCashFlow: [null, null, null, -50] },
    });
    expect(noCash.affoSource).toBe("ffo");
    expect(noCash.affo).toBe(280);
  });
});
