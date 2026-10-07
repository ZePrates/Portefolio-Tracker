import { describe, expect, it, vi } from "vitest";
import { dbError, dbErrorMessage } from "./errors";

describe("dbErrorMessage", () => {
  it("traduz códigos Postgres conhecidos", () => {
    expect(dbErrorMessage({ code: "23505", message: "duplicate key value" })).toMatch(/duplicado/);
    expect(dbErrorMessage({ code: "PGRST116" })).toBe("Registo não encontrado.");
  });

  it("usa o fallback e nunca expõe a mensagem em bruto", () => {
    expect(dbErrorMessage({ code: "XX000", message: "internal: relation foo" }, "Falhou.")).toBe(
      "Falhou.",
    );
    expect(dbErrorMessage({ message: "internal" })).toBe("Erro ao aceder à base de dados.");
    expect(dbErrorMessage(null, "Ativo não encontrado.")).toBe("Ativo não encontrado.");
  });

  it("dbError regista o original no servidor", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = dbError({ code: "23514", message: "violates check" });
    expect(e.message).toMatch(/regra de validação/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
