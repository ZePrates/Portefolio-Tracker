import { describe, expect, it } from "vitest";
import { validateExpenseAmount, validateTradeForm } from "./trade-form";

const ok = { quantity: "2,5", price: "10,20", fee: "", date: "2026-10-01" };
const today = "2026-10-08";

describe("validateTradeForm", () => {
  it("aceita vírgula decimal e comissão vazia", () => {
    expect(validateTradeForm(ok, today)).toEqual({});
  });
  it("exige quantidade positiva", () => {
    expect(validateTradeForm({ ...ok, quantity: "" }, today).quantity).toMatch(/quantidade/);
    expect(validateTradeForm({ ...ok, quantity: "0" }, today).quantity).toMatch(/maior/);
    expect(validateTradeForm({ ...ok, quantity: "abc" }, today).quantity).toMatch(/número/);
  });
  it("rejeita preço/comissão negativos e datas futuras", () => {
    const e = validateTradeForm({ ...ok, price: "-1", fee: "-2", date: "2026-12-01" }, today);
    expect(e.price).toBeDefined();
    expect(e.fee).toBeDefined();
    expect(e.date).toMatch(/futura/);
  });
});

describe("validateExpenseAmount", () => {
  it("valida o valor", () => {
    expect(validateExpenseAmount("")).toBeDefined();
    expect(validateExpenseAmount("0")).toBeDefined();
    expect(validateExpenseAmount("25,00")).toBeUndefined();
  });
});
