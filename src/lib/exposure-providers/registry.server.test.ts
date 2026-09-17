import { describe, expect, it, vi } from "vitest";
import {
  findManagerProvider,
  fetchOfficialComposition,
} from "@/lib/exposure-providers/registry.server";

describe("registry: findManagerProvider", () => {
  it("encontra a iShares pelo fundFamily", () => {
    const p = findManagerProvider({ isin: null, ticker: null, name: "", fundFamily: "iShares" });
    expect(p?.slug).toBe("ishares");
  });

  it("encontra a Vanguard pelo fundFamily", () => {
    const p = findManagerProvider({ isin: null, ticker: null, name: "", fundFamily: "Vanguard" });
    expect(p?.slug).toBe("vanguard");
  });

  it("devolve null para gestora sem fornecedor implementado (ex.: VanEck)", () => {
    const p = findManagerProvider({ isin: null, ticker: null, name: "", fundFamily: "VanEck" });
    expect(p).toBeNull();
  });

  it("devolve null para gestora completamente desconhecida", () => {
    const p = findManagerProvider({ isin: null, ticker: null, name: "", fundFamily: "Invesco" });
    expect(p).toBeNull();
  });
});

describe("registry: fetchOfficialComposition", () => {
  it("devolve null sem chamar nenhum fornecedor quando a gestora não é reconhecida", async () => {
    const result = await fetchOfficialComposition({
      isin: "XX0000000000",
      ticker: "X",
      name: "Fundo genérico",
      fundFamily: "Gestora Desconhecida",
    });
    expect(result).toBeNull();
  });

  it("propaga null quando o fornecedor da gestora reconhecida falha (ex.: sem rede)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await fetchOfficialComposition({
      isin: "IE00B4L5Y983",
      ticker: "SWDA",
      name: "iShares Core MSCI World UCITS ETF",
      fundFamily: "iShares",
    });
    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });
});
