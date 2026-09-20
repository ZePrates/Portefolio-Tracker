import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJustEtf } from "@/lib/exposure-providers/justetf.server";

// Estrutura fiel à página real (confirmada por inspeção direta de
// justetf.com/en/etf-profile.html?isin=...): as tabelas de holdings, países e
// setores são identificadas pelos atributos data-testid.
const holdingRow = (isin: string, name: string, pct: string) =>
  `<tr><td><a data-testid="tl_etf-holdings_top-holdings_link_name" href="/en/stock-profiles/${isin}" title="${name}"><span>${name}</span></a></td>` +
  `<td><span data-testid="tl_etf-holdings_top-holdings_value_percentage">${pct}%</span></td></tr>`;

const weightRow = (key: string, name: string, pct: string) =>
  `<tr><td data-testid="tl_etf-holdings_${key}_value_name">${name}</td>` +
  `<td><span data-testid="tl_etf-holdings_${key}_value_percentage">${pct}%</span></td></tr>`;

const PROFILE_HTML = `
<html><body>
<h3 data-testid="hl_etf-holdings_top-holdings_header">Top 10 Holdings</h3>
<table data-testid="etf-holdings_top-holdings_table"><tbody>
${holdingRow("US67066G1040", "NVIDIA Corp.", "4.44")}
${holdingRow("US0378331005", "Apple", "4.23")}
</tbody></table>
<h3 data-testid="hl_etf-holdings_countries_header"> Countries </h3>
<table data-testid="etf-holdings_countries_table"><tbody>
${weightRow("countries", "United States", "58.85")}
${weightRow("countries", "Japan", "5.92")}
${weightRow("countries", "United Kingdom", "3.33")}
${weightRow("countries", "Taiwan", "3.15")}
${weightRow("countries", "Other", "28.75")}
</tbody></table>
<h3 data-testid="hl_etf-holdings_sectors_header"> Sectors </h3>
<table data-testid="etf-holdings_sectors_table"><tbody>
${weightRow("sectors", "Technology", "35.46")}
${weightRow("sectors", "Finance", "18.82")}
${weightRow("sectors", "Industrials", "9.27")}
${weightRow("sectors", "Consumer Non-Cyclicals", "8.54")}
${weightRow("sectors", "Other", "27.91")}
</tbody></table>
As of 31/07/2026
</body></html>`;

function mockFetch(response: { ok: boolean; body: string } | null) {
  return vi.fn(async () => {
    if (!response) return { ok: false, status: 404, text: async () => "" };
    return { ok: response.ok, status: response.ok ? 200 : 500, text: async () => response.body };
  });
}

describe("fetchJustEtf", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sem ISIN devolve null", async () => {
    const result = await fetchJustEtf(null);
    expect(result).toBeNull();
  });

  it("extrai país, setor (incluindo 'Other', que fecha em 100%) e top holdings", async () => {
    vi.stubGlobal("fetch", mockFetch({ ok: true, body: PROFILE_HTML }));
    const result = await fetchJustEtf("IE00BK5BQT80");
    expect(result).not.toBeNull();
    expect(result?.source).toBe("justetf");
    expect(result?.asOfDate).toBe("2026-07-31");

    const countrySum = result?.countryWeights?.reduce((s, c) => s + c.weight, 0) ?? 0;
    expect(countrySum).toBeCloseTo(1, 2); // fecha em 100% por causa do "Other"
    expect(result?.countryWeights?.find((c) => c.country === "Other")?.weight).toBeCloseTo(
      0.2875,
      4,
    );

    const sectorSum = result?.sectorWeights?.reduce((s, sec) => s + sec.weight, 0) ?? 0;
    expect(sectorSum).toBeCloseTo(1, 2);

    expect(result?.holdings).toHaveLength(2);
    expect(result?.holdings[0]).toMatchObject({ name: "NVIDIA Corp." });
    expect(result?.holdings[0]?.weight).toBeCloseTo(0.0444, 4);
  });

  it("devolve null quando a fonte falha (rede), nunca lança", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await fetchJustEtf("IE00BK5BQT80");
    expect(result).toBeNull();
  });

  it("devolve null quando a página não tem nenhuma tabela reconhecida", async () => {
    vi.stubGlobal("fetch", mockFetch({ ok: true, body: "<html><body>página vazia</body></html>" }));
    const result = await fetchJustEtf("XX0000000000");
    expect(result).toBeNull();
  });

  it("devolve null em resposta HTTP não-ok", async () => {
    vi.stubGlobal("fetch", mockFetch({ ok: false, body: "" }));
    const result = await fetchJustEtf("IE00BK5BQT80");
    expect(result).toBeNull();
  });
});
