import { describe, expect, it } from "vitest";
import { dividendsCsv, formatCsvCell, toCsvPt, transactionsCsv } from "./csv";

const BOM = String.fromCharCode(0xfeff);

describe("formatCsvCell", () => {
  it("usa vírgula decimal sem separador de milhares", () => {
    expect(formatCsvCell(1234.5, "money")).toBe("1234,50");
    expect(formatCsvCell(0.123456789, "number")).toBe("0,123457");
    expect(formatCsvCell(10, "number")).toBe("10");
  });

  it("datas em dd/mm/aaaa e vazios para null/NaN", () => {
    expect(formatCsvCell("2026-10-07", "date")).toBe("07/10/2026");
    expect(formatCsvCell(null, "money")).toBe("");
    expect(formatCsvCell(Number.NaN, "money")).toBe("");
  });
});

describe("toCsvPt", () => {
  it("separador ';', CRLF, BOM e aspas quando necessário", () => {
    const csv = toCsvPt(
      [{ a: 'Texto; com "aspas"', b: 1.5 }],
      [
        { header: "A", value: (r) => r.a },
        { header: "B", value: (r) => r.b, type: "money" },
      ],
    );
    expect(csv).toBe(`${BOM}A;B\r\n"Texto; com ""aspas""";1,50\r\n`);
  });
});

describe("exportadores", () => {
  it("transactionsCsv", () => {
    const csv = transactionsCsv(
      [
        {
          traded_at: "2025-01-02",
          type: "buy",
          quantity: 10,
          price: 52.8,
          price_native: 55,
          native_currency: "USD",
          fx_rate: 0.96,
          fee: 0,
          total: 528,
          realized_pl: null,
          asset_id: "o",
        },
      ],
      () => "Realty Income",
    );
    const [, line] = csv.replace(BOM, "").split("\r\n");
    expect(line).toBe("02/01/2025;Realty Income;Compra;10;55;USD;0,96;52,8;0,00;528,00;");
  });

  it("dividendsCsv", () => {
    const csv = dividendsCsv([
      {
        asset_name: "O",
        ex_date: "2025-02-28",
        payment_date: "2025-03-14",
        paid_at: "2025-03-14",
        currency: "USD",
        gross_amount: 2.53,
        amount: 2.53,
        tax_amount: 0.38,
        net_amount: 2.15,
        status: "received",
        payment_date_estimated: false,
      },
    ]);
    expect(csv).toContain("O;28/02/2025;14/03/2025;Não;USD;2,53;0,38;2,15;received");
  });
});
