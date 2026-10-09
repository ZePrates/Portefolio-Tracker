import { describe, expect, it } from "vitest";
import { annualTaxReport, type TaxReportTransaction } from "./tax-report";
import { replayLedger } from "./fifo";

const TODAY = "2026-10-07";

const tx = (p: Partial<TaxReportTransaction> & { id: string }): TaxReportTransaction => ({
  asset_id: "us",
  type: "buy",
  quantity: 1,
  price: 1,
  fee: 0,
  traded_at: "2025-01-01",
  ...p,
});

const assets = [
  { id: "us", name: "Realty Income", class: "reit", ticker: "O" },
  { id: "ie", name: "Vanguard FTSE All-World", class: "etf", isin: "IE00BK5BQT80" },
  { id: "pt", name: "EDP", class: "acao_dividendo", ticker: "EDP.LS" },
];

describe("annualTaxReport — mais-valias", () => {
  const ledger = [
    tx({ id: "b1", quantity: 10, price: 50, fee: 2, traded_at: "2024-03-01" }),
    tx({ id: "b2", quantity: 10, price: 60, fee: 1, traded_at: "2025-06-01" }),
    tx({ id: "s1", type: "sell", quantity: 15, price: 70, fee: 3, traded_at: "2025-11-10" }),
  ];

  it("uma linha por lote FIFO, com encargos repartidos", () => {
    const r = annualTaxReport({
      year: 2025,
      assets,
      transactions: ledger,
      dividends: [],
      today: TODAY,
    });
    expect(r.capitalGains).toHaveLength(2);
    const [l1, l2] = r.capitalGains;
    expect(l1).toMatchObject({
      acquisitionDate: "2024-03-01",
      quantity: 10,
      acquisitionValue: 500,
      realizationValue: 700,
      expenses: 4, // 2 (compra) + 3 × 10/15 (venda)
      gain: 196,
      annex: "J",
      code: "G01",
      country: "US",
      shortTerm: false,
    });
    expect(l2).toMatchObject({
      acquisitionDate: "2025-06-01",
      quantity: 5,
      acquisitionValue: 300,
      realizationValue: 350,
      expenses: 1.5, // 1 × 5/10 + 3 × 5/15
      gain: 48.5,
      shortTerm: true,
    });
  });

  it("a soma das linhas é igual ao P/L realizado do FIFO", () => {
    const r = annualTaxReport({
      year: 2025,
      assets,
      transactions: ledger,
      dividends: [],
      today: TODAY,
    });
    const realized = replayLedger(ledger).realizedPL;
    expect(r.totals.netGains).toBeCloseTo(realized, 2);
    expect(r.totals.shortTermNetGains).toBeCloseTo(48.5);
    expect(r.autonomous.capitalGainsTax).toBeCloseTo(0.28 * 244.5, 2);
  });

  it("vendas de outros anos não entram; ETFs usam G20", () => {
    expect(
      annualTaxReport({ year: 2024, assets, transactions: ledger, dividends: [], today: TODAY })
        .capitalGains,
    ).toHaveLength(0);
    const etf = [
      tx({ id: "e1", asset_id: "ie", quantity: 2, price: 100, traded_at: "2024-01-01" }),
      tx({
        id: "e2",
        asset_id: "ie",
        type: "sell",
        quantity: 2,
        price: 90,
        traded_at: "2025-02-01",
      }),
    ];
    const r = annualTaxReport({
      year: 2025,
      assets,
      transactions: etf,
      dividends: [],
      today: TODAY,
    });
    expect(r.capitalGains[0]).toMatchObject({ code: "G20", annex: "J", country: "IE", gain: -20 });
    expect(r.autonomous.capitalGainsTax).toBe(0); // saldo negativo não paga
  });

  it("títulos nacionais vão para o Anexo G", () => {
    const pt = [
      tx({ id: "p1", asset_id: "pt", quantity: 10, price: 4, traded_at: "2024-01-01" }),
      tx({
        id: "p2",
        asset_id: "pt",
        type: "sell",
        quantity: 10,
        price: 5,
        traded_at: "2025-02-01",
      }),
    ];
    const r = annualTaxReport({
      year: 2025,
      assets,
      transactions: pt,
      dividends: [],
      today: TODAY,
    });
    expect(r.capitalGains[0]!.annex).toBe("G");
  });
});

describe("annualTaxReport — dividendos", () => {
  const dividends = [
    {
      asset_id: "us",
      asset_name: "Realty Income",
      amount: 100,
      gross_amount: 100,
      tax_amount: 15,
      net_amount: 85,
      paid_at: "2025-03-15",
      payment_date: "2025-03-15",
      status: "received",
    },
    {
      asset_id: "us",
      asset_name: "Realty Income",
      amount: 50,
      gross_amount: 50,
      tax_amount: 7.5,
      net_amount: 42.5,
      paid_at: "2026-01-07",
      payment_date: "2026-01-07",
      status: "received",
      payment_date_estimated: true,
    },
    {
      asset_id: "ie",
      asset_name: "Vanguard FTSE All-World",
      amount: 40,
      gross_amount: 40,
      tax_amount: 0,
      net_amount: 40,
      paid_at: "2025-06-20",
      payment_date: "2025-06-20",
      status: "received",
    },
  ];

  it("agrega por ativo pelo ano de pagamento, com retenção e crédito de imposto", () => {
    const r = annualTaxReport({ year: 2025, assets, transactions: [], dividends, today: TODAY });
    expect(r.dividends).toHaveLength(2);
    expect(r.dividends[0]).toMatchObject({
      assetId: "us",
      country: "US",
      annex: "J",
      code: "E11",
      gross: 100,
      taxWithheld: 15,
      net: 85,
      count: 1,
    });
    // PT: 28% × 140 = 39,20; crédito = min(15, 28) + min(0, 11,2) = 15
    expect(r.autonomous.dividendsTaxPt).toBeCloseTo(39.2);
    expect(r.autonomous.foreignTaxCredit).toBeCloseTo(15);
    expect(r.autonomous.dividendsTaxDue).toBeCloseTo(24.2);
  });

  it("dividendo de dezembro pago em janeiro conta no ano do pagamento e avisa se estimado", () => {
    const r = annualTaxReport({ year: 2026, assets, transactions: [], dividends, today: TODAY });
    expect(r.dividends[0]!.gross).toBe(50);
    expect(r.warnings.join(" ")).toMatch(/estimada/);
  });

  it("englobamento: dividendos UE contam 50%", () => {
    const r = annualTaxReport({
      year: 2025,
      assets,
      transactions: [],
      dividends,
      today: TODAY,
      marginalRate: 0.37,
    });
    // base = 100 (US) + 40 × 50% (IE) = 120; 120 × 37% − 15 de crédito = 29,40
    expect(r.aggregated).toEqual({ marginalRate: 0.37, total: 29.4 });
  });
});

describe("annualTaxReport — juros P2P", () => {
  const interest = [
    {
      assetId: "s",
      assetName: "Scramble",
      date: "2026-10-05",
      amount: 5.8,
      country: "EE",
      kind: "interest" as const,
    },
    {
      assetId: "s",
      assetName: "Scramble",
      date: "2026-10-05",
      amount: 0.22,
      country: "EE",
      kind: "interest" as const,
    },
    {
      assetId: "s",
      assetName: "Scramble",
      date: "2026-09-17",
      amount: 1.2,
      country: "EE",
      kind: "bonus" as const,
    },
    {
      assetId: "s",
      assetName: "Scramble",
      date: "2025-12-05",
      amount: 3,
      country: "EE",
      kind: "interest" as const,
    },
  ];

  it("agrega no Anexo J, quadro 8A, código E21, pelo ano do pagamento", () => {
    const r = annualTaxReport({
      year: 2026,
      assets: [],
      transactions: [],
      dividends: [],
      interest,
      today: "2026-12-31",
    });
    expect(r.interest).toEqual([
      {
        assetId: "s",
        assetName: "Scramble",
        country: "EE",
        annex: "J",
        code: "E21",
        gross: 6.02,
        taxWithheld: 0,
        net: 6.02,
        count: 2,
      },
    ]);
    expect(r.totals.interestGross).toBe(6.02);
    expect(r.autonomous.interestTaxDue).toBeCloseTo(6.02 * 0.28, 2);
    expect(r.autonomous.total).toBeCloseTo(6.02 * 0.28, 2);
  });

  it("separa os bónus e avisa para confirmar o enquadramento", () => {
    const r = annualTaxReport({
      year: 2026,
      assets: [],
      transactions: [],
      dividends: [],
      interest,
      today: "2026-12-31",
    });
    expect(r.bonuses).toEqual([{ assetId: "s", assetName: "Scramble", amount: 1.2 }]);
    expect(r.totals.bonuses).toBe(1.2);
    expect(r.warnings.join(" ")).toMatch(/bónus/);
  });

  it("englobamento: juros contam 100%", () => {
    const r = annualTaxReport({
      year: 2025,
      assets: [],
      transactions: [],
      dividends: [],
      interest,
      today: "2026-01-10",
      marginalRate: 0.37,
    });
    expect(r.aggregated).toEqual({ marginalRate: 0.37, total: 1.11 });
  });
});
