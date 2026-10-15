import { describe, expect, it } from "vitest";
import {
  convertXtbToEur,
  hasStockTransfers,
  matchXtbSymbol,
  parseXtbCashOperations,
  parseXtbRows,
  xtbRowsFromWorkbook,
  parseXtbDate,
  planXtbImport,
  splitCsvLine,
  xtbToYahoo,
} from "./xtb";
import { replayLedger } from "./fifo";
import { readXlsx } from "./xlsx";
import { buildXlsx } from "./xlsx-test-utils";

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

  it("um segundo lote no mesmo dia entra como novo e não gasta a estimativa anterior", () => {
    const div = (sourceId: string, date: string) => ({
      sourceId,
      date,
      symbol: "O.US",
      grossEur: 1,
      taxEur: 0.15,
      netEur: 0.85,
      currency: "USD",
      perShareNative: 0.27,
    });
    const estimate = (id: string, ex_date: string) => ({
      id,
      asset_id: "o",
      source: "yahoo",
      source_event_id: `yahoo:O:${ex_date}`,
      ex_date,
      payment_date_estimated: true,
    });
    const plan = planXtbImport({
      parsed: {
        trades: [],
        dividends: [div("2", "2025-03-14"), div("3", "2025-03-14"), div("1", "2025-02-14")],
        ignored: [],
        errors: [],
      },
      assets: [assets[0]!],
      existingTransactions: [],
      existingDividends: [estimate("mar", "2025-02-28"), estimate("fev", "2025-01-31")],
      validateLedger: validate,
    });
    expect(plan.dividends.map((d) => [d.action, d.confirmDividendId])).toEqual([
      ["confirm", "mar"],
      ["insert", undefined],
      ["confirm", "fev"],
    ]);
  });
});

describe("extrato XTB em Excel (formato novo, várias contas)", () => {
  const cell = (ref: string, v: string | number) =>
    typeof v === "number"
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const row = (n: number, values: Array<string | number | null>) =>
    `<row r="${n}">${values
      .map((v, i) => (v == null ? "" : cell(`${String.fromCharCode(65 + i)}${n}`, v)))
      .join("")}</row>`;
  const workbook = buildXlsx({
    "Cash Operations": [
      row(1, ["Account number", "52821965"]),
      row(5, ["Type", "Instrument", "Ticker", "Category", "Time", "Amount", "ID", "Comment"]),
      // 17/12/2025 20:35 UTC: duas execuções da mesma ordem de 4 ações.
      row(6, [
        "Stock purchase",
        "Novo",
        "NVO.US",
        "STOCK",
        46008.85766,
        -144,
        "1056064387",
        "OPEN BUY 3/4 @ 48.00",
      ]),
      row(7, [
        "Stock purchase",
        "Novo",
        "NVO.US",
        "STOCK",
        46008.85766,
        -48,
        "1056064386",
        "OPEN BUY 1/4 @ 48.00",
      ]),
      row(8, [
        "Stock purchase",
        "Realty",
        "O.US",
        "STOCK",
        46302.71124,
        -215,
        "1470561946",
        "OPEN BUY O.US 4 @ 53.75",
      ]),
      row(9, [
        "Stock sell",
        "Sila",
        "SILA.US",
        "STOCK",
        46210.35885,
        212.66,
        "1346508071",
        "CLOSE BUY 7 @ 30.3800",
      ]),
      row(10, [
        "Dividend",
        "Realty",
        "O.US",
        "STOCK",
        46310.43883,
        2.17,
        "1480686038",
        "O.US USD 0.2715/ SHR",
      ]),
      row(11, [
        "Withholding tax",
        "Realty",
        "O.US",
        "STOCK",
        46310.43883,
        -0.33,
        "1480686039",
        "O.US USD WHT 15%",
      ]),
      row(12, [
        "Withholding tax",
        "Agree",
        "ADC.US",
        "STOCK",
        46163.64,
        1.42,
        "1275124032",
        "US Dividends Reclassification 2025",
      ]),
      row(13, ["Deposit", null, null, null, 46000.5, 100, "1", "Deposit"]),
    ].join(""),
    "Open Positions": [
      row(1, ["Product", "Metric", "Amount", "Currency"]),
      row(2, ["My Trades", "Open position value", 3411.91, "USD"]),
    ].join(""),
  });
  const account = xtbRowsFromWorkbook(readXlsx(workbook), "USD_52821965_2006-01-01.xlsx");
  const parsed = parseXtbRows(account.rows);

  it("lê a conta, a moeda e as datas (hora UTC → dia de Lisboa)", () => {
    expect(account).toMatchObject({ account: "52821965", currency: "USD", errors: [] });
    expect(account.rows[0]).toMatchObject({ date: "2025-12-17", symbol: "NVO.US", amount: -144 });
  });

  it("junta execuções parciais, lê o ticker no comentário e as vendas", () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.trades).toEqual([
      expect.objectContaining({ sourceId: "1056064386", kind: "buy", quantity: 4, amountEur: 192 }),
      expect.objectContaining({
        sourceId: "1470561946",
        symbol: "O.US",
        quantity: 4,
        priceNative: 53.75,
      }),
      expect.objectContaining({
        sourceId: "1346508071",
        kind: "sell",
        quantity: 7,
        amountEur: 212.66,
      }),
    ]);
  });

  it("um reembolso de retenção não conta como imposto", () => {
    expect(parsed.dividends).toEqual([
      expect.objectContaining({ symbol: "O.US", grossEur: 2.17, taxEur: 0.33 }),
    ]);
    expect(parsed.ignored).toEqual(
      expect.arrayContaining([
        { type: "Withholding tax (reembolso)", count: 1 },
        { type: "Deposit", count: 1 },
      ]),
    );
    expect(hasStockTransfers(parsed)).toBe(false);
  });

  it("converte uma conta em USD para EUR ao câmbio de cada dia", () => {
    const eur = convertXtbToEur(parsed, (d) => (d === "2025-12-17" ? 0.85 : 0.9));
    expect(eur.trades[0]).toMatchObject({
      amountEur: 192 * 0.85,
      priceEur: 48 * 0.85,
      fxRate: 0.85,
    });
    expect(eur.dividends[0]!.taxEur).toBeCloseTo(0.33 * 0.9);
    const missing = convertXtbToEur(parsed, () => null);
    expect(missing.trades).toEqual([]);
    expect(missing.errors[0]!.message).toMatch(/Sem câmbio/);
  });

  it("associa cada retenção ao seu lote e anula dividendos corrigidos", () => {
    const r = (id: string, type: string, date: string, comment: string, amount: number) => ({
      line: Number(id),
      id,
      type,
      date,
      symbol: "NVO.US",
      comment,
      amount,
    });
    const out = parseXtbRows([
      // Dois lotes pagos no dia 08/04, depois anulados e pagos de novo a 13/04.
      r("100", "Dividend", "2026-04-08", "NVO.US USD 1.2174/ SHR", 4.87),
      r("101", "Withholding tax", "2026-04-08", "NVO.US USD WHT 27%", -1.31),
      r("200", "Dividend", "2026-04-08", "NVO.US USD 1.2174/ SHR", 2.43),
      r("201", "Withholding tax", "2026-04-08", "NVO.US USD WHT 27%", -0.66),
      r("300", "Dividend", "2026-04-13", "NVO.US USD 1.1968/ SHR", 4.79),
      r("301", "Withholding tax", "2026-04-13", "NVO.US USD WHT 27%", -1.29),
      r("302", "Dividend", "2026-04-13", "NVO.US USD 1.1968/ SHR", 2.39),
      r("303", "Withholding tax", "2026-04-13", "NVO.US USD WHT 27%", -0.65),
      r("400", "Dividend", "2026-04-14", "corr NVO.US USD 1.2174/ SHR from 2026-04-08", -2.43),
      r("401", "Withholding tax", "2026-04-14", "corr NVO.US USD WHT 27% from 2026-04-08", 0.66),
      r("500", "Dividend", "2026-04-14", "corr NVO.US USD 1.2174/ SHR from 2026-04-08", -4.87),
      r("501", "Withholding tax", "2026-04-14", "corr NVO.US USD WHT 27% from 2026-04-08", 1.31),
    ]);
    expect(out.errors).toEqual([]);
    expect(out.dividends).toEqual([
      expect.objectContaining({ sourceId: "300", grossEur: 4.79, taxEur: 1.29 }),
      expect.objectContaining({ sourceId: "302", grossEur: 2.39, taxEur: 0.65 }),
    ]);
    expect(out.ignored).toEqual(
      expect.arrayContaining([
        { type: "Dividend (correção + original anulado)", count: 2 },
        { type: "Withholding tax (correção)", count: 2 },
      ]),
    );
  });

  it("assinala uma correção sem o dividendo original", () => {
    const out = parseXtbRows([
      {
        line: 7,
        id: "9",
        type: "Dividend",
        date: "2026-04-14",
        symbol: "NVO.US",
        comment: "corr NVO.US USD 1.2174/ SHR from 2026-04-08",
        amount: -2.43,
      },
    ]);
    expect(out.dividends).toEqual([]);
    expect(out.errors[0]).toMatchObject({
      line: 7,
      message: expect.stringMatching(/sem o dividendo original/),
    });
  });

  it("deteta transferências de títulos entre contas", () => {
    expect(
      hasStockTransfers(
        parseXtbRows([
          {
            line: 2,
            id: "9",
            type: "Stock transfer fee",
            date: "2025-05-06",
            symbol: "O.US",
            comment: "STC",
            amount: -25,
          },
        ]),
      ),
    ).toBe(true);
  });
});
