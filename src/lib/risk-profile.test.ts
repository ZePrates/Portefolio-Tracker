import { describe, expect, it } from "vitest";
import {
  AVERSION_TABLE,
  MAX_SCORE,
  MIN_MONTHS,
  RISK_QUESTIONS,
  annualizedStats,
  aversionFromScore,
  clampShare,
  describeRiskModel,
  optimalRiskyShare,
  parseRiskInputs,
  portfolioUtility,
  profileForAversion,
  riskModel,
  riskWeights,
  riskyMonthEndValuations,
  riskyMonthlyReturns,
  sanitizeAnswers,
  scoreAnswers,
  sensitivityByAversion,
  utility,
  validateRiskInputs,
  type RiskAnswers,
  type SnapshotLike,
} from "@/lib/risk-profile";
import type { PerfTransaction, PeriodReturn } from "@/lib/performance";
import type { Asset } from "@/lib/portfolio-types";
import type { DividendRecord } from "@/lib/dividends";

const TODAY = "2026-11-20";

const asset = (p: Partial<Asset> & { id: string }): Asset =>
  ({
    user_id: "u",
    class: "etf",
    ticker: null,
    isin: null,
    name: p.id,
    quantity: 0,
    average_price: 0,
    current_price: 0,
    invested_amount: 0,
    current_value: 0,
    currency: "EUR",
    metal_type: null,
    p2p_group: null,
    annual_yield: null,
    notes: null,
    native_currency: "EUR",
    purchase_price_native: null,
    current_price_native: null,
    dividend_frequency: null,
    last_dividend_import: null,
    status: "open",
    realized_pl: 0,
    total_fees: 0,
    closed_at: null,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    ...p,
  }) as Asset;

const buy = (asset_id: string, traded_at: string, amount: number): PerfTransaction => ({
  asset_id,
  type: "buy",
  traded_at,
  quantity: 1,
  price: amount,
  fee: 0,
});

const snap = (snapshotDate: string, scope: string, marketValue: number | null): SnapshotLike => ({
  snapshotDate,
  scope,
  marketValue,
});

const allAnswers = (index: number): RiskAnswers =>
  Object.fromEntries(RISK_QUESTIONS.map((q) => [q.id, index])) as RiskAnswers;

const months = (rs: number[]): PeriodReturn[] =>
  rs.map((r, i) => ({ from: `m${i}`, to: `m${i + 1}`, r }));

describe("questionário", () => {
  it("tem entre 8 e 10 perguntas, cada uma com 4 opções", () => {
    expect(RISK_QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(RISK_QUESTIONS.length).toBeLessThanOrEqual(10);
    for (const q of RISK_QUESTIONS) expect(q.options).toHaveLength(4);
    expect(new Set(RISK_QUESTIONS.map((q) => q.id)).size).toBe(RISK_QUESTIONS.length);
  });

  it("sanitizeAnswers ignora chaves desconhecidas, valores fora do intervalo e tipos errados", () => {
    expect(
      sanitizeAnswers({ horizon: 3, drawdown: 4, income: -1, goal: 1.5, debt: "2", foo: 1 }),
    ).toEqual({ horizon: 3 });
    expect(sanitizeAnswers(null)).toEqual({});
    expect(sanitizeAnswers([1, 2])).toEqual({});
    expect(sanitizeAnswers("x")).toEqual({});
  });

  it("scoreAnswers soma os pontos e diz se está completo", () => {
    expect(scoreAnswers({})).toEqual({ score: 0, answered: 0, total: 10, complete: false });
    expect(scoreAnswers({ horizon: 3, drawdown: 2 })).toMatchObject({
      score: 5,
      answered: 2,
      complete: false,
    });
    expect(scoreAnswers(allAnswers(3))).toMatchObject({ score: MAX_SCORE, complete: true });
    expect(scoreAnswers(allAnswers(0))).toMatchObject({ score: 0, complete: true });
  });
});

describe("tabela de conversão pontuação → A", () => {
  it("cobre todas as pontuações sem buracos nem sobreposições, de A = 10 a A = 1", () => {
    expect(AVERSION_TABLE.map((b) => b.a)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(AVERSION_TABLE[0]!.minScore).toBe(0);
    expect(AVERSION_TABLE.at(-1)!.maxScore).toBe(MAX_SCORE);
    for (let i = 1; i < AVERSION_TABLE.length; i++) {
      expect(AVERSION_TABLE[i]!.minScore).toBe(AVERSION_TABLE[i - 1]!.maxScore + 1);
    }
  });

  it("converte pontuações nos limites dos escalões", () => {
    expect(aversionFromScore(0)).toBe(10);
    expect(aversionFromScore(2)).toBe(10);
    expect(aversionFromScore(3)).toBe(9);
    expect(aversionFromScore(15)).toBe(5);
    expect(aversionFromScore(26)).toBe(2);
    expect(aversionFromScore(27)).toBe(1);
    expect(aversionFromScore(30)).toBe(1);
    expect(aversionFromScore(-4)).toBe(10);
    expect(aversionFromScore(99)).toBe(1);
  });

  it("agrupa os A em cinco perfis", () => {
    expect(profileForAversion(10)).toBe("muito_conservador");
    expect(profileForAversion(7)).toBe("conservador");
    expect(profileForAversion(5)).toBe("moderado");
    expect(profileForAversion(4)).toBe("dinamico");
    expect(profileForAversion(1)).toBe("agressivo");
  });
});

describe("rentabilidades mensais da parte de risco", () => {
  const assets = [
    asset({ id: "etf1", class: "etf" }),
    asset({ id: "reit1", class: "reit" }),
    asset({ id: "p2p1", class: "p2p" }),
  ];

  it("soma as classes de risco na última fotografia de cada mês terminado", () => {
    const tx = [buy("etf1", "2026-01-05", 1000), buy("reit1", "2026-01-05", 500)];
    const snapshots = [
      snap("2026-01-30", "class:etf", 990),
      snap("2026-01-31", "class:etf", 1000),
      snap("2026-01-31", "class:reit", 500),
      snap("2026-01-31", "class:p2p", 9999),
      snap("2026-01-31", "total", 11499),
      snap("2026-02-27", "class:etf", 1100),
      snap("2026-02-27", "class:reit", 450),
      snap("2026-11-19", "class:etf", 2000), // mês corrente: fica de fora
    ];
    expect(riskyMonthEndValuations(assets, tx, snapshots, TODAY)).toEqual([
      { date: "2026-01-31", value: 1500 },
      { date: "2026-02-27", value: 1550 },
    ]);
  });

  it("ignora fotografias anteriores à primeira transação da classe e classes sem transações", () => {
    const tx = [buy("etf1", "2026-02-10", 1000)];
    const snapshots = [
      snap("2026-01-31", "class:etf", 700), // antes da 1.ª compra
      snap("2026-01-31", "class:reit", 300), // REIT sem transações
      snap("2026-02-28", "class:etf", 1000),
      snap("2026-02-28", "class:reit", 300),
    ];
    expect(riskyMonthEndValuations(assets, tx, snapshots, TODAY)).toEqual([
      { date: "2026-02-28", value: 1000 },
    ]);
  });

  it("neutraliza aportes e conta dividendos como rendimento (TWR)", () => {
    const tx = [buy("etf1", "2026-01-05", 1000), buy("etf1", "2026-02-15", 500)];
    const divs: DividendRecord[] = [
      {
        asset_id: "etf1",
        asset_name: "ETF",
        amount: 20,
        paid_at: "2026-03-10",
        status: "received",
      },
      // P2P não pertence à parte de risco
      {
        asset_id: "p2p1",
        asset_name: "P2P",
        amount: 50,
        paid_at: "2026-03-10",
        status: "received",
      },
    ];
    const snapshots = [
      snap("2026-01-31", "class:etf", 1000),
      snap("2026-02-28", "class:etf", 1600),
      snap("2026-03-31", "class:etf", 1580),
    ];
    const r = riskyMonthlyReturns(assets, tx, divs, snapshots, TODAY);
    expect(r).toHaveLength(2);
    // fevereiro: (1600 − 500) / 1000 − 1 = +10 %
    expect(r[0]!.r).toBeCloseTo(0.1, 10);
    // março: (1580 + 20) / 1600 − 1 = 0 %
    expect(r[1]!.r).toBeCloseTo(0, 10);
  });

  it("não junta dois meses num só quando falta a fotografia de um mês", () => {
    const tx = [buy("etf1", "2026-01-05", 1000)];
    const snapshots = [
      snap("2026-01-31", "class:etf", 1000),
      snap("2026-03-31", "class:etf", 1200), // fevereiro em falta
      snap("2026-04-30", "class:etf", 1260),
    ];
    const r = riskyMonthlyReturns(assets, tx, [], snapshots, TODAY);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ from: "2026-03-31", to: "2026-04-30" });
    expect(r[0]!.r).toBeCloseTo(0.05, 10);
  });
});

describe("estatísticas anualizadas", () => {
  it("anualiza a média (×12) e o desvio-padrão amostral (×√12)", () => {
    const s = annualizedStats(months([0.02, 0, 0.02, 0, 0.02, 0, 0.02, 0, 0.02, 0, 0.02, 0]));
    expect(s.unavailable).toBeNull();
    expect(s.months).toBe(12);
    expect(s.meanMonthly).toBeCloseTo(0.01, 12);
    expect(s.expectedReturn).toBeCloseTo(0.12, 12);
    const sd = Math.sqrt((12 * 0.01 ** 2) / 11);
    expect(s.volMonthly).toBeCloseTo(sd, 12);
    expect(s.volatility).toBeCloseTo(sd * Math.sqrt(12), 12);
    expect(s).toMatchObject({ from: "m0", to: "m12" });
  });

  it("recusa estimar com menos meses do que o mínimo", () => {
    const s = annualizedStats(months(Array(MIN_MONTHS - 1).fill(0.01)));
    expect(s.expectedReturn).toBeNull();
    expect(s.volatility).toBeNull();
    expect(s.unavailable).toContain("11 meses");
  });
});

describe("utilidade média-variância", () => {
  // E(r) = 12 %, σ = 20 %, rf = 2 %, A = 5 → σ² = 0,04
  it("U = E(r) − ½·A·σ²", () => {
    expect(utility(0.12, 0.2, 5)).toBeCloseTo(0.02, 12);
    expect(utility(0.12, 0.2, 1)).toBeCloseTo(0.1, 12);
  });

  it("y* = (E(r) − rf) / (A·σ²)", () => {
    expect(optimalRiskyShare(0.12, 0.2, 0.02, 5)).toBeCloseTo(0.5, 12);
    expect(optimalRiskyShare(0.12, 0.2, 0.02, 2)).toBeCloseTo(1.25, 12);
    expect(optimalRiskyShare(0.01, 0.2, 0.02, 5)).toBeLessThan(0);
    expect(optimalRiskyShare(0.12, 0, 0.02, 5)).toBeNull();
    expect(optimalRiskyShare(0.12, 0.2, 0.02, 0)).toBeNull();
  });

  it("y* maximiza a utilidade da carteira completa", () => {
    const y = optimalRiskyShare(0.12, 0.2, 0.02, 5)!;
    const best = portfolioUtility(y, 0.12, 0.2, 0.02, 5);
    // rf + (E − rf)² / (2·A·σ²) = 0,02 + 0,01 / 0,4
    expect(best).toBeCloseTo(0.045, 12);
    expect(portfolioUtility(y - 0.1, 0.12, 0.2, 0.02, 5)).toBeLessThan(best);
    expect(portfolioUtility(y + 0.1, 0.12, 0.2, 0.02, 5)).toBeLessThan(best);
    expect(portfolioUtility(0, 0.12, 0.2, 0.02, 5)).toBeCloseTo(0.02, 12);
  });

  it("limita a fração a [0, 1]", () => {
    expect(clampShare(1.4)).toBe(1);
    expect(clampShare(-0.2)).toBe(0);
    expect(clampShare(0.35)).toBe(0.35);
  });

  it("y* diminui à medida que A aumenta", () => {
    const rows = sensitivityByAversion(0.12, 0.2, 0.02);
    expect(rows).toHaveLength(10);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.yStar!).toBeGreaterThan(rows[i - 1]!.yStar!);
    }
    expect(sensitivityByAversion(null, null, 0.02).every((r) => r.yStar == null)).toBe(true);
  });
});

describe("pesos atuais", () => {
  it("separa classes de risco das defensivas e soma a liquidez às defensivas", () => {
    const w = riskWeights(
      [
        asset({ id: "e", class: "etf", quantity: 10, current_price: 60 }),
        asset({ id: "a", class: "acao_crescimento", quantity: 1, current_price: 100 }),
        asset({ id: "r", class: "reit", quantity: 2, current_price: 50 }),
        asset({ id: "m", class: "metal", quantity: 1, current_price: 100 }),
        asset({ id: "p", class: "p2p", current_value: 100, invested_amount: 100 }),
        asset({ id: "x", class: "etf", status: "closed", quantity: 5, current_price: 10 }),
      ],
      200,
    );
    expect(w.risky).toBe(800);
    expect(w.defensive).toBe(400);
    expect(w.outsideCash).toBe(200);
    expect(w.total).toBe(1200);
    expect(w.riskyShare).toBeCloseTo(2 / 3, 12);
    expect(w.byClass.map((c) => c.class)).toEqual([
      "etf",
      "acao_crescimento",
      "reit",
      "metal",
      "p2p",
    ]);
  });

  it("sem valor nenhum, o peso fica indisponível; liquidez negativa é ignorada", () => {
    expect(riskWeights([], -50)).toMatchObject({ total: 0, outsideCash: 0, riskyShare: null });
  });
});

describe("resultado do modelo e leitura", () => {
  const base = { a: 5, expected: 0.12, volatility: 0.2, riskFree: 0.02 };

  it("compara o peso atual com y* (acima, abaixo, próximo)", () => {
    expect(riskModel({ ...base, riskyShare: 0.8 })).toMatchObject({ gap: "above" });
    expect(riskModel({ ...base, riskyShare: 0.8 }).gapPp).toBeCloseTo(30, 10);
    expect(riskModel({ ...base, riskyShare: 0.3 })).toMatchObject({ gap: "below" });
    expect(riskModel({ ...base, riskyShare: 0.53 })).toMatchObject({ gap: "aligned" });
  });

  it("com y* > 1 compara com 100 % (sem alavancagem)", () => {
    const r = riskModel({ ...base, a: 2, riskyShare: 0.9 });
    expect(r.yStar).toBeCloseTo(1.25, 12);
    expect(r.yTarget).toBe(1);
    expect(r.gap).toBe("below");
    expect(r.gapPp).toBeCloseTo(-10, 10);
  });

  it("sem estatísticas, fica tudo indisponível", () => {
    expect(riskModel({ ...base, expected: null, volatility: null, riskyShare: 0.5 })).toEqual({
      utility: null,
      yStar: null,
      yTarget: null,
      gapPp: null,
      gap: "unavailable",
      utilityCurrent: null,
      utilityTarget: null,
    });
  });

  it("explica em texto simples, sem recomendar compras ou vendas", () => {
    const cases = [
      { ...base, riskyShare: 0.8 },
      { ...base, riskyShare: 0.3 },
      { ...base, riskyShare: 0.5 },
      { ...base, a: 1, riskyShare: 0.9 },
      { ...base, expected: 0.01, riskyShare: 0.5 },
    ];
    for (const c of cases) {
      const text = describeRiskModel({ ...c, months: 30 }, riskModel(c)).join(" ");
      expect(text).toContain("não uma recomendação");
      expect(text).not.toMatch(/\b(deves|devias|compra|vende|vender|comprar|reduz|aumenta)\b/i);
    }
  });

  it("descreve cada situação", () => {
    const above = describeRiskModel(
      { ...base, riskyShare: 0.8, months: 30 },
      riskModel({ ...base, riskyShare: 0.8 }),
    );
    expect(above[0]).toContain("A = 5");
    expect(above[1]).toMatch(/acima do modelo/);
    expect(above.at(-1)).toContain("30 meses");

    const lev = describeRiskModel(
      { ...base, a: 1, riskyShare: 0.9, months: 30 },
      riskModel({ ...base, a: 1, riskyShare: 0.9 }),
    );
    expect(lev[0]).toMatch(/dinheiro emprestado/);

    const low = describeRiskModel(
      { ...base, expected: 0.01, riskyShare: 0.5, months: 30 },
      riskModel({ ...base, expected: 0.01, riskyShare: 0.5 }),
    );
    expect(low[0]).toMatch(/abaixo da taxa sem risco/);

    expect(
      describeRiskModel(
        { ...base, expected: null, volatility: null, riskyShare: 0.5, months: 4 },
        riskModel({ ...base, expected: null, volatility: null, riskyShare: 0.5 }),
      ),
    ).toHaveLength(1);
  });
});

describe("pressupostos do modelo", () => {
  const ok = { riskFree: "2,5", outsideCash: "10 000", expectedReturn: "" };

  it("aceita valores válidos e campos opcionais vazios", () => {
    expect(validateRiskInputs(ok)).toEqual({});
    expect(validateRiskInputs({ ...ok, outsideCash: "", expectedReturn: "7" })).toEqual({});
  });

  it("assinala valores fora dos limites do servidor", () => {
    expect(validateRiskInputs({ ...ok, riskFree: "" })).toHaveProperty("riskFree");
    expect(validateRiskInputs({ ...ok, riskFree: "25" })).toHaveProperty("riskFree");
    expect(validateRiskInputs({ ...ok, outsideCash: "-1" })).toHaveProperty("outsideCash");
    expect(validateRiskInputs({ ...ok, outsideCash: "abc" })).toHaveProperty("outsideCash");
    expect(validateRiskInputs({ ...ok, expectedReturn: "60" })).toHaveProperty("expectedReturn");
  });

  it("converte o texto PT-PT em números; vazio usa o histórico ou o valor por omissão", () => {
    expect(parseRiskInputs(ok)).toEqual({
      riskFreePct: 2.5,
      outsideCash: 10000,
      expectedReturnPct: null,
    });
    expect(parseRiskInputs({ riskFree: "", outsideCash: "", expectedReturn: "6,5" })).toEqual({
      riskFreePct: 2,
      outsideCash: 0,
      expectedReturnPct: 6.5,
    });
  });
});
