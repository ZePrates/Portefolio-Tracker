import { describe, expect, it } from "vitest";
import { dataQualityAlerts, type DqAsset, type DqInput } from "./data-quality";

const TODAY = "2026-10-07";

const asset = (p: Partial<DqAsset> & { id: string }): DqAsset => ({
  name: p.id,
  class: "acao_dividendo",
  status: "open",
  quantity: 10,
  current_price: 100,
  ticker: "O",
  isin: null,
  price_updated_at: "2026-10-06T10:00:00Z",
  ...p,
});

const base = (p: Partial<DqInput>): DqInput => ({
  assets: [],
  transactions: [],
  dividends: [],
  holdingsCoverage: new Map(),
  today: TODAY,
  ...p,
});

const codes = (input: DqInput) => dataQualityAlerts(input).map((a) => a.code);

describe("dataQualityAlerts", () => {
  it("carteira limpa não gera alertas", () => {
    const a = asset({ id: "a" });
    expect(
      codes(
        base({
          assets: [a],
          transactions: [
            {
              id: "t",
              asset_id: "a",
              type: "buy",
              quantity: 10,
              price: 90,
              traded_at: "2025-01-01",
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("deteta preço desatualizado e preço em falta", () => {
    expect(codes(base({ assets: [asset({ id: "a", price_updated_at: "2026-09-18" })] }))).toEqual([
      "stale_price",
    ]);
    expect(codes(base({ assets: [asset({ id: "a", current_price: 0 })] }))).toEqual([
      "missing_price",
    ]);
  });

  it("deteta divergência entre quantidade e livro de movimentos", () => {
    const out = dataQualityAlerts(
      base({
        assets: [asset({ id: "a", quantity: 12 })],
        transactions: [
          { id: "t", asset_id: "a", type: "buy", quantity: 10, price: 90, traded_at: "2025-01-01" },
        ],
      }),
    );
    expect(out[0]).toMatchObject({ code: "ledger_mismatch", severity: "error" });
  });

  it("ETF sem holdings e com cobertura baixa", () => {
    const etf = asset({ id: "e", class: "etf", isin: "IE00BK5BQT80", ticker: "VWCE" });
    expect(codes(base({ assets: [etf] }))).toEqual(["etf_no_holdings"]);
    expect(codes(base({ assets: [etf], holdingsCoverage: new Map([["e", 0.3]]) }))).toEqual([
      "etf_low_coverage",
    ]);
  });

  it("dividendos de ação dos EUA sem retenção geram aviso; ETF IE não", () => {
    const us = asset({ id: "us", ticker: "O" });
    const ie = asset({ id: "ie", class: "etf", isin: "IE00BK5BQT80", ticker: "VHYL" });
    const out = dataQualityAlerts(
      base({
        assets: [us, ie],
        holdingsCoverage: new Map([["ie", 0.9]]),
        dividends: [
          { asset_id: "us", amount: 10, gross_amount: 10, tax_amount: 0 },
          { asset_id: "us", amount: 10, gross_amount: 10, tax_amount: 0 },
          { asset_id: "ie", amount: 10, gross_amount: 10, tax_amount: 0 },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: "dividend_without_tax", assetId: "us", count: 2 });
  });

  it("assinala câmbios por confirmar e datas de pagamento estimadas", () => {
    const out = codes(
      base({
        assets: [asset({ id: "a" })],
        transactions: [
          {
            id: "t",
            asset_id: "a",
            type: "buy",
            quantity: 10,
            price: 90,
            traded_at: "2025-01-01",
            native_currency: "USD",
            fx_source: null,
          },
        ],
        dividends: [{ asset_id: "a", amount: 1, tax_amount: 0.15, payment_date_estimated: true }],
      }),
    );
    expect(out).toContain("fx_unconfirmed");
    expect(out).toContain("estimated_payment_dates");
  });

  it("ordena por gravidade (erros primeiro)", () => {
    const out = dataQualityAlerts(
      base({
        assets: [
          asset({ id: "b", price_updated_at: "2026-01-01" }),
          asset({ id: "a", current_price: 0 }),
        ],
      }),
    );
    expect(out.map((a) => a.severity)).toEqual(["error", "warning"]);
  });
});
