import { describe, expect, it, vi } from "vitest";
import { runDailySnapshots } from "@/lib/daily-snapshot";

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
