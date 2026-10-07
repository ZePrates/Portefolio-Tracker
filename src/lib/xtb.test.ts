import { describe, expect, it } from "vitest";
import {
  matchXtbSymbol,
  parseXtbCashOperations,
  parseXtbDate,
  planXtbImport,
  splitCsvLine,
  xtbToYahoo,
} from "./xtb";
import { replayLedger } from "./fifo";

const CSV = [
  "ID;Type;Time;Symbol;Comment;Amount",
  "501;Deposit;02.01.2025 09:00:00;;Deposit;1000",
  '502;Stock purchase;02.01.2025 15:30:01;O.US;"OPEN BUY 10 @ 55.00";-528.00',
  "503;Stock purchase;03.02.2025 15:30:01;VWCE.DE;OPEN BUY 2/4 @ 120.50;-241.00",
  "504;DIVIDENT;14.03.2025 12:00:00;O.US;O.US USD 0.2640/ SHR;2.53",
  "505;Withholding Tax;14.03.2025 12:00:00;O.US;O.US USD WHT 15%;-0.38",
  "506;Stock sale;20.11.2025 16:00:00;O.US;CLOSE BUY 4 @ 60.00;230.40",
  "507;Free-funds Interest;01.12.2025 00:00:00;;Interest;0.12",
  ";Total;;;;1234",
].join("\n");

describe("parseXtbCashOperations", () => {
  const r = parseXtbCashOperations(CSV);

  it("lê compras e vendas com o câmbio efetivo do broker", () => {
    expect(r.errors).toEqual([]);
    expect(r.trades).toHaveLength(3);
    expect(r.trades[0]).toMatchObject({
      sourceId: "502",
      kind: "buy",
      date: "2025-01-02",
      symbol: "O.US",
      quantity: 10,
      priceNative: 55,
      amountEur: 528,
      priceEur: 52.8,
    });
    expect(r.trades[0]!.fxRate).toBeCloseTo(0.96);
    // execução parcial "2/4": conta a quantidade executada
    expect(r.trades[1]).toMatchObject({ quantity: 2, priceNative: 120.5, fxRate: 1 });
    expect(r.trades[2]).toMatchObject({ kind: "sell", quantity: 4, amountEur: 230.4 });
  });

  it("junta o dividendo com a retenção na fonte do mesmo dia", () => {
    expect(r.dividends).toEqual([
      {
        sourceId: "504",
        date: "2025-03-14",
        symbol: "O.US",
        grossEur: 2.53,
        taxEur: 0.38,
        netEur: 2.53 - 0.38,
        currency: "USD",
        perShareNative: 0.264,
      },
    ]);
  });

  it("ignora (e conta) tipos sem efeito na carteira", () => {
    expect(r.ignored).toEqual([
      { type: "Deposit", count: 1 },
      { type: "Free-funds Interest", count: 1 },
    ]);
  });

  it("aceita separador vírgula e aspas", () => {
    const csv =
      'ID,Type,Time,Symbol,Comment,Amount\n9,Stock purchase,2025-05-05 10:00,"AAPL.US","OPEN BUY 1 @ 200.00",-180.5';
    const p = parseXtbCashOperations(csv);
    expect(p.trades[0]).toMatchObject({ date: "2025-05-05", quantity: 1, amountEur: 180.5 });
  });

  it("reporta cabeçalho em falta e linhas inválidas", () => {
    expect(parseXtbCashOperations("a;b\n1;2").errors[0]!.message).toMatch(/Cabeçalho/);
    const bad = parseXtbCashOperations(
      "ID;Type;Time;Symbol;Comment;Amount\n1;Stock purchase;31.02.2025;O.US;OPEN BUY 1 @ 1;-1",
    );
    expect(bad.errors).toHaveLength(1);
    expect(bad.trades).toHaveLength(0);
  });
});

describe("utilitários", () => {
  it("parseXtbDate", () => {
    expect(parseXtbDate("02.01.2025 15:30:01")).toBe("2025-01-02");
    expect(parseXtbDate("2025-01-02 15:30")).toBe("2025-01-02");
    expect(parseXtbDate("31.02.2025")).toBeNull();
  });

  it("splitCsvLine trata aspas escapadas", () => {
    expect(splitCsvLine('a;"b;""c""";d', ";")).toEqual(["a", 'b;"c"', "d"]);
  });

  it("xtbToYahoo converte sufixos de bolsa", () => {
    expect(xtbToYahoo("AAPL.US")).toBe("AAPL");
    expect(xtbToYahoo("VUSA.UK")).toBe("VUSA.L");
    expect(xtbToYahoo("IWDA.NL")).toBe("IWDA.AS");
    expect(xtbToYahoo("MC.FR")).toBe("MC.PA");
    expect(xtbToYahoo("EDP.PT")).toBe("EDP.LS");
  });
});

describe("matchXtbSymbol", () => {
  const assets = [
    { id: "o", ticker: "O", price_source: "yahoo:O" },
    { id: "vwce", ticker: "VWCE", price_source: "yahoo:VWCE.DE" },
    { id: "inra", ticker: "INRA", price_source: "yahoo:INRA.AS" },
  ];

  it("por símbolo Yahoo exato (price_source)", () => {
    expect(matchXtbSymbol("O.US", assets)).toBe("o");
    expect(matchXtbSymbol("VWCE.DE", assets)).toBe("vwce");
    expect(matchXtbSymbol("INRA.NL", assets)).toBe("inra");
  });

  it("pelo símbolo-base quando é único, senão não adivinha", () => {
    expect(matchXtbSymbol("VWCE.IT", assets)).toBe("vwce");
    expect(matchXtbSymbol("XYZ.US", assets)).toBeNull();
    expect(
      matchXtbSymbol("ABC.DE", [
        { id: "1", ticker: "ABC.L" },
        { id: "2", ticker: "ABC.AS" },
      ]),
    ).toBeNull();
  });
});

describe("planXtbImport", () => {
  const parsed = parseXtbCashOperations(CSV);
  const assets = [
    { id: "o", ticker: "O", price_source: "yahoo:O" },
    { id: "vwce", ticker: "VWCE", price_source: "yahoo:VWCE.DE" },
  ];
  const validate = (entries: Parameters<typeof replayLedger>[0]) => {
    replayLedger(entries);
  };

  it("concilia o movimento manual igual em vez de o duplicar", () => {
    const plan = planXtbImport({
      parsed,
      assets,
      existingTransactions: [
        {
          id: "m1",
          asset_id: "o",
          type: "buy",
          quantity: 10,
          price: 47.3, // câmbio de hoje (errado)
          traded_at: "2025-01-02",
          source: "manual",
        },
      ],
      existingDividends: [],
      validateLedger: validate,
    });
    const o = plan.trades.filter((t) => t.assetId === "o");
    expect(o.map((t) => t.action)).toEqual(["reconcile", "insert"]);
    expect(o[0]!.reconcileTxId).toBe("m1");
    expect(plan.summary).toMatchObject({ reconcile: 1, insert: 2, duplicate: 0 });
  });

  it("não reimporta o mesmo ID XTB", () => {
    const plan = planXtbImport({
      parsed,
      assets,
      existingTransactions: [
        {
          id: "x",
          asset_id: "o",
          type: "buy",
          quantity: 10,
          price: 52.8,
          traded_at: "2025-01-02",
          source_event_id: "xtb:502",
        },
      ],
      existingDividends: [],
      validateLedger: validate,
    });
    expect(plan.trades.find((t) => t.trade.sourceId === "502")!.action).toBe("duplicate");
  });

  it("bloqueia o ativo se o livro resultante for inválido", () => {
    const sellOnly = parseXtbCashOperations(
      "ID;Type;Time;Symbol;Comment;Amount\n1;Stock sale;02.01.2025;O.US;CLOSE BUY 5 @ 60;250",
    );
    const plan = planXtbImport({
      parsed: sellOnly,
      assets,
      existingTransactions: [],
      existingDividends: [],
      validateLedger: validate,
    });
    expect(plan.trades[0]!.action).toBe("blocked");
    expect(plan.trades[0]!.reason).toMatch(/só detinhas 0/);
  });

  it("confirma o dividendo estimado do Yahoo mais próximo e lista símbolos sem ativo", () => {
    const plan = planXtbImport({
      parsed,
      assets: [assets[0]!],
      existingTransactions: [],
      existingDividends: [
        {
          id: "y1",
          asset_id: "o",
          source: "yahoo",
          source_event_id: "yahoo:O:2025-02-28",
          ex_date: "2025-02-28",
          payment_date_estimated: true,
        },
        {
          id: "y0",
          asset_id: "o",
          source: "yahoo",
          source_event_id: "yahoo:O:2024-11-29",
          ex_date: "2024-11-29",
          payment_date_estimated: true,
        },
      ],
      validateLedger: validate,
    });
    expect(plan.dividends[0]).toMatchObject({ action: "confirm", confirmDividendId: "y1" });
    expect(plan.unmatchedSymbols).toEqual(["VWCE.DE"]);
  });
});
