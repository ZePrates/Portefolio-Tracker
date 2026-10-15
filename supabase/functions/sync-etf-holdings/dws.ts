// Leitura do Excel de composição da DWS/Xtrackers, sem dependências Deno para
// poder ser testada com o vitest do projeto. Recebe a grelha já lida pelo xlsx.
//
// Cabeçalho real (out/2026): Name | ISIN | Country | Currency | Exchange |
// Type of Security | Rating | Primary Listing | Industry Classification | Weighting.
// "Type of Security" traz "Equities", "Depository Receipts", "Right", "Cash" e
// "Future"; as linhas de dinheiro/futuros têm códigos internos no lugar do ISIN
// (ex.: "_CURRENCYUSD", "___ADI2VD121") e os futuros vêm com peso "N/A".

export type DwsRow = {
  name: string;
  isin: string | null;
  weight: number;
  country: string | null;
  currency: string | null;
  sector: string | null;
  asset_class: "Equity" | "Cash and/or Derivatives";
  exchange: string | null;
};

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const NOT_EQUITY_RE = /cash|currenc|future|forward|swap|option|deriv|\bfx\b|money market|deposit\b/i;
const EQUITY_RE = /equit|share|stock|depositary|depository|\breit\b/i;

/** Ação quando há ISIN (ou o tipo diz ação) e o tipo não é claramente dinheiro/derivado. */
export function dwsAssetClass(type: unknown, isin: string | null): DwsRow["asset_class"] {
  const t = String(type ?? "").trim();
  if (NOT_EQUITY_RE.test(t)) return "Cash and/or Derivatives";
  return isin || EQUITY_RE.test(t) ? "Equity" : "Cash and/or Derivatives";
}

const text = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s && s !== "-" ? s : null;
};

// deno-lint-ignore no-explicit-any
export function parseDwsGrid(grid: any[][], today = new Date().toISOString().slice(0, 10)): { asOf: string; rows: DwsRow[] } {
  const hIdx = grid.findIndex((row) => row.some((c) => /^name$/i.test(String(c ?? "").trim())) && row.some((c) => /weight/i.test(String(c ?? ""))));
  if (hIdx < 0) throw new Error("Formato do Excel DWS não reconhecido");
  const head = grid[hIdx].map((c) => String(c ?? "").trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const cName = col(/^name$/), cIsin = col(/isin/), cW = col(/weight/), cCountry = col(/country/), cCur = col(/currency/), cSector = col(/industry|sector/), cType = col(/type/), cExch = col(/exchange/);
  const dateText = grid.slice(0, hIdx).flat().map((c) => String(c ?? "")).join(" ");
  const dm = dateText.match(/(\d{2})[./](\d{2})[./](\d{4})/);
  const asOf = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : today;
  const at = (x: unknown[], i: number) => (i >= 0 ? text(x[i]) : null);
  let rows: DwsRow[] = grid
    .slice(hIdx + 1)
    .filter((x) => x[cName] && x[cW] != null)
    .map((x) => {
      const code = at(x, cIsin);
      const isin = code && ISIN_RE.test(code) ? code : null;
      return {
        name: String(x[cName]).trim(),
        isin,
        weight: Number(String(x[cW]).replace("%", "").replace(",", ".")),
        country: at(x, cCountry),
        currency: at(x, cCur),
        sector: at(x, cSector),
        asset_class: dwsAssetClass(cType >= 0 ? x[cType] : null, isin),
        exchange: at(x, cExch),
      };
    })
    .filter((x) => Number.isFinite(x.weight));
  const total = rows.reduce((s, x) => s + (x.weight > 0 ? x.weight : 0), 0);
  if (total > 1.5) rows = rows.map((x) => ({ ...x, weight: x.weight / 100 }));
  return { asOf, rows };
}
