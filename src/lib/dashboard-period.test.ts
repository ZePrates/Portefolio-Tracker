import { describe, expect, it } from "vitest";
import { periodRange } from "@/lib/dashboard";
import { heroSeries, periodChange, type SnapshotLike } from "@/lib/dashboard-period";

const TODAY = "2026-10-08";

const snap = (date: string, marketValue: number | null, invested = 0): SnapshotLike => ({
  snapshotDate: date,
  scope: "total",
  investedAmount: invested,
  marketValue,
});

const base = {
  today: TODAY,
  totalResult: 500,
  totalReturnPct: 5,
  transactions: [],
  dividends: [],
};

describe("periodChange", () => {
  it("no período total usa o resultado do ledger", () => {
    const r = periodChange({
      ...base,
      isAll: true,
      range: periodRange("all", TODAY),
      currentValue: 10_500,
      snapshots: [],
    });
    expect(r).toEqual({ amount: 500, pct: 5, baselineDate: null });
  });

  it("sem fotografia de partida devolve null (nunca estima)", () => {
    const r = periodChange({
      ...base,
      isAll: false,
      range: periodRange("ytd", TODAY),
      currentValue: 10_500,
      snapshots: [snap(TODAY, 10_500)],
    });
    expect(r).toBeNull();
  });

  it("usa a última fotografia antes do período e desconta aportes", () => {
    const r = periodChange({
      ...base,
      isAll: false,
      range: periodRange("ytd", TODAY),
      currentValue: 11_500,
      snapshots: [snap("2025-12-30", 10_000), snap("2026-06-01", 10_800)],
      transactions: [{ type: "buy", traded_at: "2026-03-01", quantity: 10, price: 50, fee: 0 }],
    });
    // 11 500 − 10 000 − 500 de aporte = 1 000
    expect(r?.amount).toBeCloseTo(1000);
    expect(r?.baselineDate).toBe("2025-12-30");
    expect(r?.pct).not.toBeNull();
  });

  it("começa na primeira fotografia disponível quando o histórico é mais curto", () => {
    const r = periodChange({
      ...base,
      isAll: false,
      range: periodRange("1y", TODAY),
      currentValue: 1_100,
      snapshots: [snap("2026-09-01", 1_000)],
    });
    expect(r?.baselineDate).toBe("2026-09-01");
    expect(r?.amount).toBeCloseTo(100);
  });
});

describe("heroSeries", () => {
  it("inclui a fotografia de partida e ignora valores nulos", () => {
    const rows = [
      snap("2025-12-30", 10_000, 9_000),
      snap("2026-02-01", null),
      snap("2026-03-01", 10_500, 9_000),
    ];
    const s = heroSeries(rows, periodRange("ytd", TODAY), TODAY);
    expect(s.map((p) => p.date)).toEqual(["2025-12-30", "2026-03-01"]);
    expect(s[1]).toMatchObject({ marketValue: 10_500, invested: 9_000 });
  });
});
