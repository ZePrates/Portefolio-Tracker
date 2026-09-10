import { describe, expect, it } from "vitest";
import {
  auditDividendRecord,
  findDuplicateGroups,
  classifyDividend,
  computeDividend,
  computeDividendHistory,
  isReceived,
  quantityHeldBefore,
  receivedByCurrency,
  receivedByMonth,
  totalReceived,
  yieldOnCost,
  type DividendTrade,
} from "@/lib/dividends";

const TODAY = "2026-09-02";
const eur = (exDate: string, perShare: number, paymentDate = exDate) => ({
  exDate,
  paymentDate,
  perShareNative: perShare,
  currency: "EUR",
  fxRate: 1,
});

const buy = (traded_at: string, quantity: number): DividendTrade => ({ type: "buy", quantity, traded_at });
const sell = (traded_at: string, quantity: number): DividendTrade => ({ type: "sell", quantity, traded_at });

describe("quantidade elegível na data ex-dividendo", () => {
  it("compra 10 ações → dividendo de €1 → €10", () => {
    const d = computeDividend([buy("2026-01-10", 10)], eur("2026-06-10", 1), TODAY)!;
    expect(d.eligibleQuantity).toBe(10);
    expect(d.grossAmount).toBe(10);
  });

  it("compra 10, venda 4 DEPOIS do ex-date → €10", () => {
    const trades = [buy("2026-01-10", 10), sell("2026-08-01", 4)];
    const d = computeDividend(trades, eur("2026-06-10", 1), TODAY)!;
    expect(d.eligibleQuantity).toBe(10);
    expect(d.grossAmount).toBe(10);
  });

  it("compra 10, venda 6 ANTES do ex-date → €4", () => {
    const trades = [buy("2026-01-10", 10), sell("2026-05-01", 6)];
    const d = computeDividend(trades, eur("2026-06-10", 1), TODAY)!;
    expect(d.eligibleQuantity).toBe(4);
    expect(d.grossAmount).toBe(4);
  });

  it("duas compras (5 + 5) com ex-date entre elas e outro depois", () => {
    const trades = [buy("2026-01-10", 5), buy("2026-07-01", 5)];
    const first = computeDividend(trades, eur("2026-06-10", 1), TODAY)!;
    const second = computeDividend(trades, eur("2026-08-10", 1), TODAY)!;
    expect(first.eligibleQuantity).toBe(5);
    expect(second.eligibleQuantity).toBe(10);
  });

  it("compra na própria data ex-dividendo não é elegível", () => {
    expect(quantityHeldBefore([buy("2026-06-10", 10)], "2026-06-10")).toBe(0);
  });

  it("posição totalmente vendida mantém dividendos anteriores no histórico", () => {
    const trades = [buy("2026-01-10", 10), sell("2026-08-20", 10)];
    const history = computeDividendHistory(trades, [eur("2026-06-10", 1), eur("2026-09-01", 1)], TODAY);
    expect(history).toHaveLength(1);
    expect(history[0]!.grossAmount).toBe(10);
    expect(quantityHeldBefore(trades, TODAY)).toBe(0);
  });
});

describe("histórico desde a compra", () => {
  it("não atribui dividendos anteriores à aquisição", () => {
    const trades = [buy("2026-03-01", 10)];
    const history = computeDividendHistory(
      trades,
      [eur("2025-06-10", 1), eur("2026-01-10", 1), eur("2026-06-10", 1)],
      TODAY,
    );
    expect(history.map((h) => h.exDate)).toEqual(["2026-06-10"]);
  });

  it("sem compras não há dividendos", () => {
    expect(computeDividendHistory([], [eur("2026-06-10", 1)], TODAY)).toEqual([]);
  });
});

describe("moeda e conversão", () => {
  it("dividendo em USD mantém o valor original e converte para EUR", () => {
    const d = computeDividend(
      [buy("2026-01-10", 10)],
      {
        exDate: "2026-06-10",
        paymentDate: "2026-06-25",
        perShareNative: 0.5,
        currency: "USD",
        fxRate: 0.9,
        fxDate: "2026-06-25",
      },
      TODAY,
    )!;
    expect(d.currency).toBe("USD");
    expect(d.amountNative).toBeCloseTo(5, 10);
    expect(d.grossAmount).toBeCloseTo(4.5, 10);
    expect(d.fxRate).toBe(0.9);
    expect(d.fxDate).toBe("2026-06-25");
  });
});

describe("previstos vs recebidos", () => {
  it("dividendo futuro não conta como recebido", () => {
    const d = computeDividend([buy("2026-01-10", 10)], eur("2026-11-01", 1, "2026-11-20"), TODAY)!;
    expect(d.status).toBe("scheduled");
    expect(
      totalReceived(
        [
          {
            asset_id: "a",
            asset_name: "X",
            amount: d.grossAmount,
            gross_amount: d.grossAmount,
            payment_date: d.paymentDate,
            paid_at: d.paymentDate!,
            status: d.status,
          },
        ],
        TODAY,
      ),
    ).toBe(0);
  });

  it("sem data de pagamento o evento fica por confirmar", () => {
    expect(classifyDividend(null, TODAY)).toBe("unknown");
    expect(isReceived({ asset_id: "a", asset_name: "X", amount: 5, paid_at: "2026-01-01", status: "unknown" }, TODAY)).toBe(false);
  });

  it("dividendo pago no passado conta como recebido", () => {
    expect(classifyDividend("2026-08-20", TODAY)).toBe("received");
  });
});

describe("dividendo líquido", () => {
  it("separa bruto, imposto e líquido sem inventar valores", () => {
    const d = computeDividend(
      [buy("2026-01-10", 10)],
      { ...eur("2026-06-10", 1), taxAmount: 1.5, feeAmount: 0.5 },
      TODAY,
    )!;
    expect(d.grossAmount).toBe(10);
    expect(d.netAmount).toBe(8);
    const semImposto = computeDividend([buy("2026-01-10", 10)], eur("2026-06-10", 1), TODAY)!;
    expect(semImposto.taxAmount).toBe(0);
    expect(semImposto.netAmount).toBe(semImposto.grossAmount);
  });
});

describe("sincronização idempotente", () => {
  it("executar duas vezes produz exatamente os mesmos eventos (mesma chave)", () => {
    const trades = [buy("2026-01-10", 10)];
    const events = [eur("2026-03-10", 1), eur("2026-06-10", 1)];
    const run1 = computeDividendHistory(trades, events, TODAY);
    const run2 = computeDividendHistory(trades, [...events, ...events], TODAY);
    const keys = (rows: typeof run1) => new Set(rows.map((r) => `yahoo:X:${r.exDate}`));
    expect(keys(run1)).toEqual(keys(run2));
    expect(keys(run1).size).toBe(2);
  });
});

describe("auditoria", () => {
  const trades = [buy("2026-01-10", 10)];

  it("deteta futuro marcado como recebido e quantidade errada", () => {
    const { issues } = auditDividendRecord(
      {
        asset_id: "a",
        asset_name: "X",
        amount: 99,
        gross_amount: 99,
        ex_date: "2026-06-10",
        payment_date: "2026-12-01",
        paid_at: "2026-12-01",
        status: "received",
        currency: "EUR",
        fx_rate: 1,
        per_share_native: 1,
        eligible_quantity: 50,
      },
      trades,
      TODAY,
    );
    expect(issues).toContain("future_marked_received");
    expect(issues).toContain("eligible_quantity_mismatch");
    expect(issues).toContain("amount_mismatch");
  });

  it("registo correto não gera problemas", () => {
    const { issues } = auditDividendRecord(
      {
        asset_id: "a",
        asset_name: "X",
        amount: 10,
        gross_amount: 10,
        ex_date: "2026-06-10",
        payment_date: "2026-06-25",
        paid_at: "2026-06-25",
        status: "received",
        currency: "EUR",
        fx_rate: 1,
        per_share_native: 1,
        eligible_quantity: 10,
      },
      trades,
      TODAY,
    );
    expect(issues).toEqual([]);
  });

  it("agrupa duplicados pelo mesmo evento", () => {
    const row = {
      asset_id: "a",
      asset_name: "X",
      amount: 10,
      ex_date: "2026-06-10",
      paid_at: "2026-06-25",
      currency: "EUR",
      per_share_native: 1,
    };
    expect(findDuplicateGroups([{ ...row, id: "1" }, { ...row, id: "2" }])).toHaveLength(1);
    expect(findDuplicateGroups([{ ...row, id: "1" }])).toHaveLength(0);
  });
});

describe("agregações", () => {
  const rows = [
    { asset_id: "a", asset_name: "A", amount: 10, gross_amount: 10, currency: "USD", amount_native: 11, payment_date: "2026-08-20", paid_at: "2026-08-20", status: "received" },
    { asset_id: "a", asset_name: "A", amount: 5, gross_amount: 5, currency: "USD", amount_native: 5.5, payment_date: "2026-05-20", paid_at: "2026-05-20", status: "received" },
    { asset_id: "b", asset_name: "B", amount: 7, gross_amount: 7, currency: "EUR", amount_native: 7, payment_date: "2026-12-20", paid_at: "2026-12-20", status: "scheduled" },
  ];

  it("totais mensais e por moeda ignoram previstos", () => {
    expect(totalReceived(rows, TODAY)).toBe(15);
    expect(receivedByMonth(rows, TODAY)).toEqual({ "2026-08": 10, "2026-05": 5 });
    expect(receivedByCurrency(rows, TODAY)).toEqual({ USD: 16.5 });
  });

  it("yield sobre o custo", () => {
    expect(yieldOnCost(15, 300)).toBeCloseTo(5, 10);
    expect(yieldOnCost(15, 0)).toBeNull();
  });
});
