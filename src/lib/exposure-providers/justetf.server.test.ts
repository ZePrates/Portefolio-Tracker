import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJustEtf } from "@/lib/exposure-providers/justetf.server";

// Estrutura simplificada mas fiel à página real (confirmada por inspeção direta
// de justetf.com/en/etf-profile.html?isin=IE00BK5BQT80): tabelas de duas
// colunas (nome, peso%) sob os cabeçalhos "Countries" e "Sectors", e uma
// lista de holdings com link para a ficha da empresa sob "Top 10 Holdings".
const PROFILE_HTML = `
<html><body>
<h3>Holdings</h3>
<h4>Top 10 Holdings</h4>
<p>Weight of top 10 holdings out of 3,758 23.51%</p>
<table>
<tr><td><a href="https://www.justetf.com/en/stock-profiles/US67066G1040">NVIDIA Corp.</a></td><td>4.44%</td></tr>
<tr><td><a href="https://www.justetf.com/en/stock-profiles/US0378331005">Apple</a></td><td>4.23%</td></tr>
</table>
<h4>Countries</h4>
<table>
<tr><td>United States</td><td>58.85%</td></tr>
<tr><td>Japan</td><td>5.92%</td></tr>
<tr><td>United Kingdom</td><td>3.33%</td></tr>
<tr><td>Taiwan</td><td>3.15%</td></tr>
<tr><td>Other</td><td>28.75%</td></tr>
</table>
<h4>Sectors</h4>
<table>
<tr><td>Technology</td><td>35.46%</td></tr>
<tr><td>Finance</td><td>18.82%</td></tr>
<tr><td>Industrials</td><td>9.27%</td></tr>
<tr><td>Consumer Non-Cyclicals</td><td>8.54%</td></tr>
<tr><td>Other</td><td>27.91%</td></tr>
</table>
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
