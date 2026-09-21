import { describe, expect, it } from "vitest";
import {
  annualYieldPercent,
  estimateAnnualDividend,
  frequencyLabel,
  inferPaymentsPerYear,
  ttmDividends,
} from "@/lib/yield";

const NOW = new Date("2026-09-21T00:00:00Z");

/** Histórico tipo Accenture: trimestral, mas o Yahoo só devolve 2 dos 4 do último ano. */
const ACN_DIVIDENDS = [
  { date: "2024-10-10", amount: 1.48 },
  { date: "2025-01-09", amount: 1.48 },
  { date: "2025-04-10", amount: 1.48 },
  { date: "2025-07-10", amount: 1.48 },
  // últimos 12 meses: faltam out/2025 e jan/2026 na fonte
  { date: "2026-04-09", amount: 1.63 },
  { date: "2026-07-09", amount: 1.63 },
];

describe("inferPaymentsPerYear", () => {
  it("deteta cadência trimestral", () => {
    expect(inferPaymentsPerYear(ACN_DIVIDENDS)).toBe(4);
  });

  it("deteta cadência mensal", () => {
    const monthly = [
      { date: "2026-05-15", amount: 0.2 },
      { date: "2026-06-15", amount: 0.2 },
      { date: "2026-07-15", amount: 0.2 },
      { date: "2026-08-14", amount: 0.2 },
    ];
    expect(inferPaymentsPerYear(monthly)).toBe(12);
  });

  it("devolve null com histórico insuficiente", () => {
    expect(inferPaymentsPerYear([{ date: "2026-01-10", amount: 1 }])).toBeNull();
    expect(inferPaymentsPerYear([])).toBeNull();
  });
});

describe("estimateAnnualDividend", () => {
  it("anualiza o dividendo mais recente quando faltam pagamentos (ACN)", () => {
    // 1,63 × 4 = 6,52 — não a soma incompleta de 3,26
    expect(estimateAnnualDividend(ACN_DIVIDENDS, NOW)).toBeCloseTo(6.52, 2);
  });

  it("usa a soma real quando o último ano está completo", () => {
    const full = [
      { date: "2025-06-10", amount: 1.5 },
      { date: "2025-10-10", amount: 1.48 },
      { date: "2026-01-09", amount: 1.48 },
      { date: "2026-04-09", amount: 1.63 },
      { date: "2026-07-09", amount: 1.63 },
    ];
    // últimos 12 meses: out/25 + jan/26 + abr/26 + jul/26 = 6,22
    expect(estimateAnnualDividend(full, NOW)).toBeCloseTo(6.22, 2);
  });

  it("devolve null sem dados — nunca inventa", () => {
    expect(estimateAnnualDividend([], NOW)).toBeNull();
    expect(estimateAnnualDividend([{ date: "2020-01-10", amount: 1 }], NOW)).toBeNull();
  });
});

describe("ttmDividends", () => {
  it("soma apenas os últimos 12 meses", () => {
    expect(ttmDividends(ACN_DIVIDENDS, NOW)).toBeCloseTo(3.26, 2);
  });
});

describe("annualYieldPercent", () => {
  it("ACN: ~3,6% e não 1,8%", () => {
    const y = annualYieldPercent(ACN_DIVIDENDS, 181.29, NOW);
    expect(y).not.toBeNull();
    expect(y!).toBeGreaterThan(3.5);
    expect(y!).toBeLessThan(3.7);
  });

  it("null sem preço válido", () => {
    expect(annualYieldPercent(ACN_DIVIDENDS, 0, NOW)).toBeNull();
  });
});

describe("frequencyLabel", () => {
  it("mapeia cadências para rótulos", () => {
    expect(frequencyLabel(4)).toBe("Trimestral");
    expect(frequencyLabel(12)).toBe("Mensal");
    expect(frequencyLabel(null)).toBeNull();
  });
});
