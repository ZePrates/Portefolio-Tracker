import { describe, expect, it } from "vitest";
import {
  assetSortValue,
  isQuantityClass,
  isSecurityClass,
  paysDividendsClass,
  stripLedgerFields,
} from "./asset-class";
import type { Asset } from "./portfolio-types";
import { CLASS_LABELS, CLASS_ORDER } from "./portfolio-types";
import { ASSETS_NAV } from "@/components/nav-config";

describe("regras por classe", () => {
  it("classifica títulos, ativos por quantidade e pagadores de dividendos", () => {
    expect(isSecurityClass("etf")).toBe(true);
    expect(isSecurityClass("metal")).toBe(false);
    expect(isQuantityClass("metal")).toBe(true);
    expect(isQuantityClass("p2p")).toBe(false);
    expect(paysDividendsClass("reit")).toBe(true);
    expect(paysDividendsClass("acao_crescimento")).toBe(false);
  });
});

describe("stripLedgerFields", () => {
  it("remove os campos derivados do FIFO e mantém os restantes", () => {
    const patch = {
      name: "X",
      quantity: 5,
      average_price: 10,
      invested_amount: 50,
      current_price: 12,
    };
    // Antes: editar um ativo com movimentos reescrevia a quantidade e o custo FIFO.
    expect(stripLedgerFields(patch)).toEqual({ name: "X", current_price: 12 });
  });
});

describe("assetSortValue", () => {
  const a = {
    name: "Zeta",
    quantity: 2,
    average_price: 10,
    current_price: 15,
    invested_amount: 20,
    current_value: 30,
    annual_yield: null,
    status: "open",
    class: "reit",
  } as unknown as Asset;

  it("devolve o valor de ordenação de cada coluna", () => {
    expect(assetSortValue(a, "name")).toBe("zeta");
    expect(assetSortValue(a, "value")).toBe(30);
    expect(assetSortValue(a, "pl")).toBe(10);
    expect(assetSortValue(a, "yield")).toBe(-1);
  });
});
