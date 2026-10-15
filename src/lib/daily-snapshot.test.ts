import { describe, expect, it, vi } from "vitest";
import { planOpenAppSnapshot, priceFreshness, runDailySnapshots } from "@/lib/daily-snapshot";

describe("runDailySnapshots", () => {
  it("atualiza preços e tira a fotografia de cada utilizador (sem duplicados)", async () => {
    const calls: string[] = [];
    const r = await runDailySnapshots({
      listUserIds: async () => ["a", "b", "a"],
      refreshPrices: async (u) => {
        calls.push(`prices:${u}`);
        return { updated: 2, failed: u === "b" ? ["X: sem cotação"] : [] };
      },
      takeSnapshot: async (u) => {
        calls.push(`snap:${u}`);
      },
    });
    expect(calls).toEqual(["prices:a", "snap:a", "prices:b", "snap:b"]);
    expect(r).toEqual({ users: 2, ok: 2, failed: [], pricesUpdated: 4, priceFailures: 1 });
  });

  it("se os preços falham, a fotografia é tirada na mesma; se a fotografia falha, segue para o próximo", async () => {
    const snap = vi.fn(async (u: string) => {
      if (u === "b") throw new Error("db em baixo");
    });
    const r = await runDailySnapshots({
      listUserIds: async () => ["a", "b", "c"],
      refreshPrices: async () => {
        throw new Error("yahoo em baixo");
      },
      takeSnapshot: snap,
    });
    expect(snap).toHaveBeenCalledTimes(3);
    expect(r.ok).toBe(2);
    expect(r.failed).toEqual([{ userId: "b", error: "db em baixo" }]);
    expect(r.priceFailures).toBe(3);
  });
});

describe("planOpenAppSnapshot", () => {
  const base = { today: "2026-10-15", hasPricedAssets: true };

  it("cotações antigas: atualiza e regrava a fotografia de hoje, mesmo que já exista", () => {
    expect(
      planOpenAppSnapshot({ ...base, hasTodaySnapshot: true, latestPriceDate: "2026-10-13" }),
    ).toEqual({ refresh: true, snapshot: true });
    expect(
      planOpenAppSnapshot({ ...base, hasTodaySnapshot: false, latestPriceDate: null }),
    ).toEqual({ refresh: true, snapshot: true });
  });

  it("cotações de hoje: só grava se ainda não houver fotografia", () => {
    expect(
      planOpenAppSnapshot({ ...base, hasTodaySnapshot: true, latestPriceDate: "2026-10-15" }),
    ).toEqual({ refresh: false, snapshot: false });
    expect(
      planOpenAppSnapshot({ ...base, hasTodaySnapshot: false, latestPriceDate: "2026-10-15" }),
    ).toEqual({ refresh: false, snapshot: true });
  });

  it("só P2P (sem cotações): nunca atualiza", () => {
    expect(
      planOpenAppSnapshot({
        today: "2026-10-15",
        hasPricedAssets: false,
        hasTodaySnapshot: false,
        latestPriceDate: null,
      }),
    ).toEqual({ refresh: false, snapshot: true });
  });
});

describe("priceFreshness", () => {
  it("classifica por dias de calendário", () => {
    expect(priceFreshness("2026-10-15", "2026-10-15", 3)).toEqual({ level: "today", days: 0 });
    expect(priceFreshness("2026-10-14", "2026-10-15", 3)).toEqual({ level: "old", days: 1 });
    expect(priceFreshness("2026-10-12", "2026-10-15", 3)).toEqual({ level: "stale", days: 3 });
    expect(priceFreshness(null, "2026-10-15", 3)).toEqual({ level: "none", days: 0 });
  });

  it("atravessa a mudança de hora sem erro de arredondamento", () => {
    expect(priceFreshness("2026-10-24", "2026-10-26", 3)).toEqual({ level: "old", days: 2 });
  });
});
