import { describe, expect, it } from "vitest";
import { ASSETS_NAV, CLASS_ROUTES } from "@/components/nav-config";
import { CLASS_LABELS, CLASS_ORDER } from "@/lib/portfolio-types";

describe("nomes das classes", () => {
  it("o menu usa o mesmo nome que o resto da app para cada classe", () => {
    for (const c of CLASS_ORDER) {
      const item = ASSETS_NAV.find((i) => i.to === CLASS_ROUTES[c]);
      expect(item?.label, c).toBe(CLASS_LABELS[c]);
    }
  });
});
