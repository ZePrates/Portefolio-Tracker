import { describe, expect, it } from "vitest";
import { chartDateTicks } from "./chart-dates";

describe("calendar axis tick selection", () => {
  it("selects only one existing date per month without changing the series", () => {
    const dates = ["2026-10-18", "2026-10-19", "2026-11-02", "2026-11-30", "2027-01-01"];
    const original = [...dates];
    expect(chartDateTicks(dates)).toEqual(["2026-10-18", "2026-11-02", "2027-01-01"]);
    expect(dates).toEqual(original);
  });

  it("spaces multi-year horizons at least three calendar months apart", () => {
    const dates = Array.from(
      { length: 28 },
      (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-19`,
    );
    expect(chartDateTicks(dates)).toEqual(dates.filter((_, i) => i % 3 === 0));
  });

  it("keeps monthly ticks for horizons shorter than two years", () => {
    expect(chartDateTicks(["2026-10", "2026-11", "2026-12", "2027-01"])).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
  });

  it("handles empty, unordered and sparse series without invented dates", () => {
    expect(chartDateTicks([])).toEqual([]);
    expect(chartDateTicks(["2027-01-04", "2024-10-18", "2024-11-01", "invalid"])).toEqual([
      "2024-10-18",
      "2027-01-04",
    ]);
  });
});
