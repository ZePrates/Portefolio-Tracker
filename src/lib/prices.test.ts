import { describe, expect, it } from "vitest";
import {
  TROY_OUNCE_GRAMS,
  isValidCurrency,
  isValidPrice,
  planPriceUpdate,
  positionValueEUR,
  runPriceUpdate,
  toPricePerGram,
  type PriceablePosition,
  type Quote,
} from "@/lib/prices";
import { applySale, buildOpenLots, type LedgerEntry } from "@/lib/fifo";
import { metalSymbol } from "@/lib/metals.server";

const now = new Date("2026-09-02T12:00:00.000Z");

function asset(over: Partial<PriceablePosition> = {}): PriceablePosition {
  return {
    id: "a1",
    name: "Teste",
    class: "acao_dividendo",
    quantity: 10,
    current_price: 90,
    current_price_native: 100,
    native_currency: "USD",
    ...over,
  };
}

describe("validação financeira", () => {
  it("rejeita preços inválidos", () => {
    expect(isValidPrice(0)).toBe(false);
    expect(isValidPrice(-1)).toBe(false);
    expect(isValidPrice(Number.NaN)).toBe(false);
    expect(isValidPrice(12.5)).toBe(true);
  });
  it("rejeita moedas inválidas", () => {
    expect(isValidCurrency("usd")).toBe(false);
    expect(isValidCurrency("")).toBe(false);
    expect(isValidCurrency("USD")).toBe(true);
  });
});

describe("planPriceUpdate", () => {
  const quote = (over: Partial<Quote> = {}): Quote => ({
    price: 120,
    currency: "USD",
    source: "yahoo:O",
    ...over,
  });

  it("atualiza uma ação com conversão USD→EUR", () => {
    const res = planPriceUpdate(asset(), quote(), 0.9, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.patch.current_price_native).toBe(120);
    expect(res.patch.native_currency).toBe("USD");
    expect(res.patch.current_price).toBeCloseTo(108, 10);
    expect(res.patch.current_value).toBeCloseTo(1080, 10);
    expect(res.patch.fx_rate).toBe(0.9);
    expect(res.patch.price_source).toBe("yahoo:O");
    expect(res.patch.price_updated_at).toBe(now.toISOString());
  });

  it("atualiza um ETF em EUR sem alterar o valor", () => {
    const res = planPriceUpdate(
      asset({ class: "etf", native_currency: "EUR", quantity: 5 }),
      quote({ price: 50, currency: "EUR", source: "yahoo:VWCE.DE" }),
      1,
      now,
    );
    expect(res.ok && res.patch.current_value).toBe(250);
  });

  it("atualiza um REIT", () => {
    const res = planPriceUpdate(asset({ class: "reit" }), quote({ price: 60 }), 0.5, now);
    expect(res.ok && res.patch.current_price).toBe(30);
  });

  it("não destrói o preço anterior quando a API falha", () => {
    expect(planPriceUpdate(asset(), null, 0.9, now)).toEqual({
      ok: false,
      error: "Sem cotação da fonte.",
    });
    expect(planPriceUpdate(asset(), quote({ price: 0 }), 0.9, now).ok).toBe(false);
    expect(planPriceUpdate(asset(), quote({ currency: "XX" }), 0.9, now).ok).toBe(false);
    expect(planPriceUpdate(asset(), quote(), null, now).ok).toBe(false);
  });
});

describe("prata / metais", () => {
  it("resolve símbolos estruturados", () => {
    expect(metalSymbol("Prata", null)).toBe("SI=F");
    expect(metalSymbol("Ouro", null)).toBe("GC=F");
    expect(metalSymbol(null, "xagusd=x")).toBe("XAGUSD=X");
  });

  it("converte onça troy para grama", () => {
    expect(toPricePerGram(TROY_OUNCE_GRAMS, "troy_ounce")).toBeCloseTo(1, 10);
    expect(toPricePerGram(1000, "kilogram")).toBe(1);
    expect(toPricePerGram(5, "gram")).toBe(5);
  });

  it("atualiza uma posição de prata em gramas", () => {
    // 31 USD/oz → ~0.9967 USD/g; 500 g; câmbio 0.9
    const perGram = toPricePerGram(31.1034768, "troy_ounce");
    const res = planPriceUpdate(
      asset({ class: "metal", quantity: 500, native_currency: "USD" }),
      { price: perGram, currency: "USD", source: "yahoo:SI=F", unit: "troy_ounce" },
      0.9,
      now,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.patch.current_price_native).toBeCloseTo(1, 10);
    expect(res.patch.current_value).toBeCloseTo(450, 8);
  });
});

describe("valor da posição em moeda estrangeira", () => {
  it("quantidade × preço nativo × taxa", () => {
    expect(positionValueEUR(3, 200, 0.92)).toBeCloseTo(552, 10);
  });
});

describe("runPriceUpdate", () => {
  it("mantém os restantes ativos quando um falha", async () => {
    const assets = Array.from({ length: 20 }, (_, i) => asset({ id: `a${i}`, name: `Ativo ${i}` }));
    const saved: string[] = [];
    const res = await runPriceUpdate(
      assets,
      async (a) => (a.id === "a7" ? null : { price: 10, currency: "USD", source: "yahoo:X" }),
      async () => 1,
      async (a) => {
        saved.push(a.id);
      },
      now,
    );
    expect(res.updated).toBe(19);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]?.id).toBe("a7");
    expect(saved).not.toContain("a7");
  });

  it("um erro de gravação não interrompe a operação", async () => {
    const res = await runPriceUpdate(
      [asset({ id: "x" }), asset({ id: "y" })],
      async () => ({ price: 10, currency: "USD", source: "yahoo:X" }),
      async () => 1,
      async (a) => {
        if (a.id === "x") throw new Error("falha de gravação");
      },
      now,
    );
    expect(res.updated).toBe(1);
    expect(res.failed[0]?.error).toBe("falha de gravação");
  });
});

describe("prata: venda FIFO e custo de armazenamento", () => {
  const ledger: LedgerEntry[] = [
    { id: "t1", type: "buy", quantity: 300, price: 0.8, fee: 0, traded_at: "2026-01-10" },
    { id: "t2", type: "buy", quantity: 200, price: 1.0, fee: 0, traded_at: "2026-03-10" },
  ];

  it("vende gramas de prata pelo custo FIFO", () => {
    const lots = buildOpenLots(ledger);
    const sale = applySale(lots, 400, 1.2, 0);
    // 300 g @0.8 + 100 g @1.0 = 340 de custo; receita 480 → +140
    expect(sale.costBasis).toBeCloseTo(340, 8);
    expect(sale.proceeds).toBeCloseTo(480, 8);
    expect(sale.realizedPL).toBeCloseTo(140, 8);
    expect(sale.remainingQuantity).toBeCloseTo(100, 8);
  });

  it("custo de armazenamento não altera a quantidade detida", () => {
    const lots = buildOpenLots(ledger);
    const before = lots.reduce((s, l) => s + l.quantity, 0);
    const expense = { amount: 25, currency: "EUR", incurred_at: "2026-06-30" };
    const after = buildOpenLots(ledger).reduce((s, l) => s + l.quantity, 0);
    expect(expense.amount).toBe(25);
    expect(after).toBe(before);
  });
});

describe("ausência de LLM", () => {
  it("os módulos de preços não importam nenhum cliente de IA", async () => {
    const files = [
      "src/lib/prices.ts",
      "src/lib/prices.functions.ts",
      "src/lib/metals.server.ts",
      "src/lib/yahoo.server.ts",
      "src/lib/dividends.functions.ts",
    ];
    const fs = await import("node:fs/promises");
    for (const f of files) {
      const src = await fs.readFile(f, "utf8");
      expect(src).not.toMatch(/openai|ai-gateway|LOVABLE_API_KEY|generateText|anthropic|gemini/i);
    }
  });
});
