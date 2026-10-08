import { describe, expect, it } from "vitest";
import { currentRateOf, nativeAverageCost, needsHistoricalRate, resolveTradeFx } from "./fx";

const TODAY = "2026-10-07";

describe("resolveTradeFx", () => {
  it("EUR é sempre 1", () => {
    expect(resolveTradeFx({ nativeCurrency: "EUR", tradedAt: "2025-01-02", today: TODAY })).toEqual(
      {
        rate: 1,
        source: "eur",
      },
    );
  });

  it("compra antiga em USD usa a taxa da data, não a de hoje (IRS)", () => {
    // Comportamento anterior: usava sempre a taxa atual (0,86) para qualquer data.
    const fx = resolveTradeFx({
      nativeCurrency: "USD",
      tradedAt: "2025-02-17",
      today: TODAY,
      currentRate: 0.86,
      historicalRate: 0.954,
    });
    expect(fx).toEqual({ rate: 0.954, source: "historical" });
  });

  it("movimento de hoje usa a taxa atual", () => {
    const fx = resolveTradeFx({
      nativeCurrency: "USD",
      tradedAt: TODAY,
      today: TODAY,
      currentRate: 0.86,
      historicalRate: 0.85,
    });
    expect(fx).toEqual({ rate: 0.86, source: "current" });
  });

  it("taxa manual (extrato do broker) tem prioridade", () => {
    const fx = resolveTradeFx({
      nativeCurrency: "usd",
      tradedAt: "2025-02-17",
      today: TODAY,
      manualRate: 0.9555,
      currentRate: 0.86,
      historicalRate: 0.954,
    });
    expect(fx).toEqual({ rate: 0.9555, source: "manual" });
  });

  it("sem histórico usa a atual mas sinaliza", () => {
    const fx = resolveTradeFx({
      nativeCurrency: "USD",
      tradedAt: "2025-02-17",
      today: TODAY,
      currentRate: 0.86,
      historicalRate: null,
    });
    expect(fx).toEqual({ rate: 0.86, source: "current_fallback" });
  });

  it("sem nenhuma taxa lança erro em vez de assumir 1", () => {
    expect(() =>
      resolveTradeFx({ nativeCurrency: "USD", tradedAt: "2025-02-17", today: TODAY }),
    ).toThrow(/Sem taxa de câmbio USD→EUR/);
  });

  it("ignora taxas inválidas (0, negativas, NaN)", () => {
    const fx = resolveTradeFx({
      nativeCurrency: "USD",
      tradedAt: "2025-02-17",
      today: TODAY,
      manualRate: 0,
      currentRate: Number.NaN,
      historicalRate: 0.95,
    });
    expect(fx.source).toBe("historical");
  });
});

describe("needsHistoricalRate", () => {
  it("não precisa para EUR, taxa manual ou movimento de hoje com taxa atual", () => {
    expect(
      needsHistoricalRate({ nativeCurrency: "EUR", tradedAt: "2025-01-01", today: TODAY }),
    ).toBe(false);
    expect(
      needsHistoricalRate({
        nativeCurrency: "USD",
        tradedAt: "2025-01-01",
        today: TODAY,
        manualRate: 0.9,
      }),
    ).toBe(false);
    expect(
      needsHistoricalRate({
        nativeCurrency: "USD",
        tradedAt: TODAY,
        today: TODAY,
        currentRate: 0.86,
      }),
    ).toBe(false);
    expect(
      needsHistoricalRate({
        nativeCurrency: "USD",
        tradedAt: "2025-01-01",
        today: TODAY,
        currentRate: 0.86,
      }),
    ).toBe(true);
  });
});

describe("currentRateOf", () => {
  it("prefere fx_rate guardado; senão deriva do preço", () => {
    expect(currentRateOf({ native_currency: "USD", fx_rate: 0.86 })).toBe(0.86);
    expect(
      currentRateOf({
        native_currency: "USD",
        fx_rate: null,
        current_price: 86,
        current_price_native: 100,
      }),
    ).toBeCloseTo(0.86);
    expect(currentRateOf({ native_currency: "EUR" })).toBe(1);
    expect(currentRateOf({ native_currency: "USD" })).toBeNull();
  });
});

describe("nativeAverageCost", () => {
  it("usa o câmbio de cada lote, não o atual", () => {
    const avg = nativeAverageCost(
      [{ id: "a", quantity: 1, unitCost: 172.34 }],
      new Map([["a", 0.85588]]),
    );
    expect(avg).toBeCloseTo(201.36, 1);
  });
  it("faz a média ponderada de vários lotes", () => {
    const avg = nativeAverageCost(
      [
        { id: "a", quantity: 1, unitCost: 90 },
        { id: "b", quantity: 3, unitCost: 45 },
      ],
      new Map([
        ["a", 0.9],
        ["b", 0.9],
      ]),
    );
    expect(avg).toBeCloseTo((100 + 3 * 50) / 4, 6);
  });
  it("devolve null sem câmbio conhecido", () => {
    expect(nativeAverageCost([{ id: "a", quantity: 1, unitCost: 1 }], new Map())).toBeNull();
  });
});
