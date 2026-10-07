import { describe, expect, it } from "vitest";
import { projectDividendCalendar, type CalendarAsset } from "./dividend-calendar";

const TODAY = "2026-10-07";

const asset = (p: Partial<CalendarAsset> & { id: string }): CalendarAsset => ({
  name: p.id,
  class: "reit",
  status: "open",
  quantity: 100,
  ticker: "O",
  native_currency: "USD",
  fx_rate: 0.9,
  ...p,
});

const quarterly = (assetId: string, last: string, perShare: number) => {
  const d = new Date(`${last}T00:00:00Z`);
  return [0, 1, 2, 3, 4].map((i) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() - i * 91);
    return {
      asset_id: assetId,
      ex_date: x.toISOString().slice(0, 10),
      per_share_native: perShare,
      currency: "USD",
      fx_rate: 0.92,
    };
  });
};

describe("projectDividendCalendar", () => {
  it("projeta 4 pagamentos trimestrais em 12 meses, com retenção e câmbio atual", () => {
    const cal = projectDividendCalendar({
      assets: [asset({ id: "o" })],
      history: quarterly("o", "2026-09-01", 0.8),
      today: TODAY,
    });
    expect(cal.events).toHaveLength(4);
    const first = cal.events[0]!;
    expect(first.exDate > TODAY).toBe(true);
    // 100 × 0,80 USD × 0,90 = 72 € bruto; EUA 15% → 61,20 € líquido
    expect(first).toMatchObject({ gross: 72, tax: 10.8, net: 61.2, currency: "USD" });
    expect(cal.totalNet).toBeCloseTo(4 * 61.2);
    expect(cal.byMonth.reduce((s, m) => s + m.net, 0)).toBeCloseTo(cal.totalNet);
  });

  it("ignora posições fechadas e assinala dividendos suspensos ou irregulares", () => {
    const cal = projectDividendCalendar({
      assets: [
        asset({ id: "closed", status: "closed" }),
        asset({ id: "old" }),
        asset({ id: "irregular" }),
      ],
      history: [
        ...quarterly("closed", "2026-09-01", 1),
        ...quarterly("old", "2025-01-01", 1),
        { asset_id: "irregular", ex_date: "2026-01-01", per_share_native: 1 },
        { asset_id: "irregular", ex_date: "2026-08-15", per_share_native: 1 },
      ],
      today: TODAY,
    });
    expect(cal.events).toHaveLength(0);
    expect(cal.skipped.map((s) => s.assetId).sort()).toEqual(["irregular", "old"]);
  });

  it("ETF UCITS irlandês em EUR: sem retenção nem câmbio", () => {
    const cal = projectDividendCalendar({
      assets: [
        asset({
          id: "vhyl",
          class: "etf",
          isin: "IE00B8GKDB10",
          native_currency: "EUR",
          quantity: 10,
        }),
      ],
      history: quarterly("vhyl", "2026-09-20", 0.5).map((h) => ({ ...h, currency: "EUR" })),
      today: TODAY,
      months: 3,
    });
    expect(cal.events).toHaveLength(1);
    expect(cal.events[0]).toMatchObject({ gross: 5, tax: 0, net: 5 });
  });
});
