import { describe, expect, it, vi } from "vitest";
import {
  cronSnapshotDate,
  dailySnapshotStatus,
  planOpenAppSnapshot,
  priceFreshness,
  runDailySnapshots,
  serviceKeyProblem,
} from "@/lib/daily-snapshot";

describe("cronSnapshotDate", () => {
  it("execução atrasada para depois da meia-noite conta para o dia anterior", () => {
    // 27/10 00:42 UTC (= Lisboa, sem horário de verão) → fotografia de 26/10.
    expect(cronSnapshotDate(new Date("2026-10-27T00:42:21Z"))).toBe("2026-10-26");
    expect(cronSnapshotDate(new Date("2026-10-29T01:10:05Z"))).toBe("2026-10-28");
  });

  it("execução à hora marcada fica no próprio dia", () => {
    expect(cronSnapshotDate(new Date("2026-10-29T21:30:00Z"))).toBe("2026-10-29");
    // Horário de verão: 21:30 UTC = 22:30 em Lisboa.
    expect(cronSnapshotDate(new Date("2026-07-15T21:30:00Z"))).toBe("2026-07-15");
    // Atraso de 3 h em pleno verão: 00:30 UTC = 01:30 em Lisboa → dia anterior.
    expect(cronSnapshotDate(new Date("2026-07-16T00:30:00Z"))).toBe("2026-07-15");
  });
});

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

describe("serviceKeyProblem", () => {
  it("recusa chave em falta ou publicável; aceita a secreta", () => {
    expect(serviceKeyProblem(undefined)).toMatch(/em falta/);
    expect(serviceKeyProblem("")).toMatch(/em falta/);
    expect(serviceKeyProblem("sb_publishable_abc")).toMatch(/publicável/);
    expect(serviceKeyProblem("sb_secret_abc")).toBeNull();
  });
});

describe("dailySnapshotStatus", () => {
  const base = { ok: 0, failed: [], pricesUpdated: 0, priceFailures: 0 };

  it("0 utilizadores é erro (a tarefa não fez nada)", () => {
    expect(dailySnapshotStatus({ ...base, users: 0 })).toBe(500);
  });

  it("207 se algum utilizador falhou, 200 se correu tudo", () => {
    expect(
      dailySnapshotStatus({ ...base, users: 2, ok: 1, failed: [{ userId: "b", error: "x" }] }),
    ).toBe(207);
    expect(dailySnapshotStatus({ ...base, users: 2, ok: 2 })).toBe(200);
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
