import { describe, expect, it } from "vitest";
import { dedupeTrades, normalizeTrade, tradeFingerprint } from "@/lib/import-history";
const base = {
  assetId: "a",
  type: "buy",
  quantity: 2,
  price: 10,
  fee: 1,
  tradedAt: "2026-01-01T10:00:00Z",
  source: "broker",
};
describe("import history", () => {
  it("normaliza", () =>
    expect(normalizeTrade(base)).toMatchObject({ type: "buy", quantity: 2, price: 10 }));
  it("remove duplicados por evento", () => {
    const x = { ...base, sourceEventId: "x" };
    expect(dedupeTrades([x, x])).toHaveLength(1);
  });
  it("fallback fingerprint distingue movimentos", () => {
    expect(tradeFingerprint(normalizeTrade(base))).not.toBe(
      tradeFingerprint(normalizeTrade({ ...base, quantity: 3 })),
    );
  });
});
