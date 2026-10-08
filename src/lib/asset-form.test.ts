import { describe, expect, it } from "vitest";
import { validateAssetForm, type AssetFormValues } from "./asset-form";

const base: AssetFormValues = {
  name: "Realty Income",
  isin: "",
  quantity: "10",
  purchase_price: "52,30",
  purchase_date: "2026-03-01",
  current_price: "55",
  invested_amount: "",
  current_value: "",
  annual_yield: "",
};
const opts = { quantityAsset: true, editing: false, isEtf: false, today: "2026-10-08" };

describe("validateAssetForm", () => {
  it("aceita um formulário completo com vírgula decimal", () => {
    expect(validateAssetForm(base, opts)).toEqual({});
  });

  it("exige nome e data de compra quando há quantidade", () => {
    const e = validateAssetForm({ ...base, name: "  ", purchase_date: "" }, opts);
    expect(e.name).toBeDefined();
    expect(e.purchase_date).toMatch(/data da compra/);
  });

  it("não deixa datas de compra futuras (mas só na criação)", () => {
    expect(validateAssetForm({ ...base, purchase_date: "2026-12-01" }, opts).purchase_date).toMatch(
      /futura/,
    );
    expect(
      validateAssetForm({ ...base, purchase_date: "2026-12-01" }, { ...opts, editing: true }),
    ).toEqual({});
  });

  it("rejeita números inválidos em vez de os tratar como 0", () => {
    const e = validateAssetForm(
      { ...base, quantity: "abc", purchase_price: "-5", current_price: "1,2,3" },
      opts,
    );
    expect(e.quantity).toMatch(/número/);
    expect(e.purchase_price).toMatch(/negativo/);
    expect(e.current_price).toMatch(/número/);
  });

  it("valida o ISIN só nos ETFs, quando preenchido", () => {
    const etf = { ...opts, isEtf: true };
    expect(validateAssetForm({ ...base, isin: "IE00BK5BQT80" }, etf)).toEqual({});
    expect(validateAssetForm({ ...base, isin: "IE00BK5BQT8" }, etf).isin).toBeDefined();
    expect(validateAssetForm({ ...base, isin: "lixo" }, opts)).toEqual({});
  });

  it("classes sem quantidade validam os montantes e o yield", () => {
    const p2p = { ...opts, quantityAsset: false };
    const e = validateAssetForm(
      { ...base, invested_amount: "x", current_value: "100", annual_yield: "120" },
      p2p,
    );
    expect(e.invested_amount).toBeDefined();
    expect(e.current_value).toBeUndefined();
    expect(e.annual_yield).toBeDefined();
    expect(validateAssetForm({ ...base, annual_yield: "5,2" }, p2p)).toEqual({});
  });
});
