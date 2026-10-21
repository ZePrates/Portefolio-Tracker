import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  calendarMonths,
  shortCompanyName,
  projectDividendCalendar,
  type CalendarAsset,
  type ProjectedDividend,
} from "./dividend-calendar";

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

describe("buildMonthGrid", () => {
  it("começa à segunda-feira e preenche com null fora do mês", () => {
    // 1 de novembro de 2026 é domingo: 6 vazios antes.
    const weeks = buildMonthGrid("2026-11");
    expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(weeks.at(-1)).toEqual(["2026-11-30", null, null, null, null, null, null]);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("fevereiro que começa à segunda cabe em 4 semanas; bissexto vai até dia 29", () => {
    // 1 de fevereiro de 2027 é segunda; 2028 é bissexto (1 fev = terça).
    expect(buildMonthGrid("2027-02")).toHaveLength(4);
    const leap = buildMonthGrid("2028-02").flat().filter(Boolean);
    expect(leap).toHaveLength(29);
    expect(leap.at(-1)).toBe("2028-02-29");
  });
});

describe("calendarMonths", () => {
  const ev = (paymentDate: string, assetName: string, net: number): ProjectedDividend => ({
    assetId: assetName,
    assetName,
    exDate: paymentDate,
    paymentDate,
    perShareNative: 1,
    currency: "EUR",
    quantity: 1,
    gross: net,
    tax: 0,
    net,
  });

  it("lista todos os meses do horizonte, mesmo sem pagamentos", () => {
    const months = calendarMonths({ events: [], today: "2026-10-21", months: 6 });
    expect(months.map((m) => m.month)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
    ]);
    expect(months.every((m) => m.count === 0 && m.net === 0)).toBe(true);
  });

  it("agrupa por mês e por dia, com ativos únicos pela ordem de pagamento", () => {
    const months = calendarMonths({
      events: [
        ev("2026-11-28", "Realty Income", 4.12),
        ev("2026-11-14", "Coca-Cola", 12.4),
        ev("2026-11-14", "PepsiCo", 5.6),
        ev("2026-11-01", "Realty Income", 4.12),
      ],
      today: "2026-10-21",
      months: 3,
    });
    const nov = months.find((m) => m.month === "2026-11")!;
    expect(nov.count).toBe(4);
    expect(nov.net).toBeCloseTo(26.24);
    expect(nov.assets).toEqual(["Realty Income", "Coca-Cola", "PepsiCo"]);
    expect(nov.byDay["2026-11-14"]!.map((e) => e.assetName)).toEqual(["Coca-Cola", "PepsiCo"]);
  });

  it("estende o fim até ao último pagamento estimado depois do horizonte", () => {
    const months = calendarMonths({
      events: [ev("2027-02-05", "VWRL", 10)],
      today: "2026-10-21",
      months: 3,
    });
    expect(months.at(-1)!.month).toBe("2027-02");
  });
});

describe("shortCompanyName", () => {
  it("tira só a forma jurídica no fim do nome", () => {
    expect(shortCompanyName("Realty Income Corporation")).toBe("Realty Income");
    expect(shortCompanyName("Apple Hospitality REIT, Inc.")).toBe("Apple Hospitality REIT");
    expect(shortCompanyName("UnitedHealth Group Incorporated")).toBe("UnitedHealth Group");
    expect(shortCompanyName("Bristol-Myers Squibb Company")).toBe("Bristol-Myers Squibb");
    expect(shortCompanyName("VICI Properties Inc.")).toBe("VICI Properties");
    expect(shortCompanyName("Unilever PLC")).toBe("Unilever");
  });

  it("mantém nomes sem forma jurídica e nunca devolve vazio", () => {
    expect(shortCompanyName("Vanguard FTSE All-World UCITS ETF")).toBe(
      "Vanguard FTSE All-World UCITS ETF",
    );
    expect(shortCompanyName("Corporation")).toBe("Corporation");
  });
});
