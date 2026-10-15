import type { AssetExposureDetail } from "./exposure.functions";
import type { Slice } from "./exposure-types";
import { countryLabel } from "./exposure-visuals";
import { exposureSector } from "./exposure-display";
export const equityHolding = (h: { assetClass?: string | null; asset_class?: string | null }) => {
  const value = h.assetClass ?? h.asset_class;
  return !value || value.trim().toLowerCase() === "equity";
};
export const canCompareEtfs = (a: string | null, b: string | null) => a === "full" && b === "full";
export function detailSlices(
  detail: AssetExposureDetail,
  dimension: "country" | "sector",
): Slice[] {
  const rows = detail.dimensions.filter((r) => r.dimension === dimension);
  const values = rows.length
    ? rows
    : detail.holdings.map((h) => ({ value: h[dimension] ?? "Não disponível", pct: h.pct }));
  return values.map((r) => ({
    value: dimension === "country" ? countryLabel(r.value) : exposureSector(r.value),
    pct: r.pct,
    amount: (detail.value * r.pct) / 100,
    contributors: [],
  }));
}
export const managerName = (slug?: string | null, source?: string | null) => {
  const value = (slug ?? source ?? "").toLowerCase();
  if (value.includes("ishares")) return "iShares";
  if (value.includes("vanguard")) return "Vanguard";
  if (value.includes("xtrackers")) return "Xtrackers";
  if (value.includes("globalx")) return "Global X";
  if (value.includes("vaneck")) return "VanEck";
  return slug || "Outra gestora";
};
