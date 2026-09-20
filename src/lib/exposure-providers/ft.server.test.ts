import { describe, expect, it } from "vitest";
import { parseFtHoldings, parseFtSearchCodes, pickFtCode } from "./ft.server";

const SEARCH_HTML = `
<a href="/data/etfs/tearsheet/summary?s=VPN:LSE:USD">VPN</a>
<a href="/data/etfs/tearsheet/summary?s=V9N:GER:EUR">V9N</a>
<a href="/data/etfs/tearsheet/summary?s=V9N:DUS">V9N</a>
`;

const HOLDINGS_HTML = `
<table><tr><th>Type</th><th>% Net assets</th><th>% Short</th><th>% Long</th></tr>
<tr><td><span>Non-UK stock</span></td><td>99.76%</td><td>0.00%</td><td>99.76%</td></tr></table>
<table>
<tr><td><span>Real Estate</span></td><td>58.77%</td><td>6.22%</td></tr>
<tr><td><span>Technology</span></td><td>38.75%</td><td>2.43%</td></tr>
<tr><td><span>Energy</span></td><td>0.00%</td><td>13.94%</td></tr>
</table>
<table>
<tr><td><span>Americas</span></td><td>0.00%</td><td>0.00%</td></tr>
<tr><td><span>Greater Asia</span></td><td>0.00%</td><td>0.00%</td></tr>
</table>
<table>
<tr><td><a href="/data/equities/tearsheet/summary?s=DLR:NYQ">Digital Realty Trust, Inc.</a><br/><span>DLR:NYQ</span></td><td><span>+6.28%</span></td><td>12.73%</td><td>12.73%</td></tr>
<tr><td><a href="/data/equities/tearsheet/summary?s=AMT:NYQ">American Tower Corporation</a><br/><span>AMT:NYQ</span></td><td><span>-9.87%</span></td><td>12.66%</td><td>12.66%</td></tr>
</table>
`;

describe("fornecedor Financial Times", () => {
  it("resolve o código da listagem a partir da pesquisa por ISIN", () => {
    const codes = parseFtSearchCodes(SEARCH_HTML);
    expect(codes).toContain("V9N:GER:EUR");
    expect(pickFtCode(codes)).toBe("V9N:GER:EUR");
  });

  it("lê setores, regiões e top holdings, ignorando pesos a zero", () => {
    const parsed = parseFtHoldings(HOLDINGS_HTML);
    expect(parsed).not.toBeNull();
    expect(parsed!.sectorWeights).toEqual([
      { sector: "Real Estate", weight: 0.5877 },
      { sector: "Technology", weight: 0.3875 },
    ]);
    expect(parsed!.countryWeights).toEqual([]);
    expect(parsed!.holdings[0]).toEqual({
      name: "Digital Realty Trust, Inc.",
      weight: 0.1273,
    });
  });

  it("devolve null quando não há dados reconhecíveis", () => {
    expect(parseFtHoldings("<html><body>sem tabelas</body></html>")).toBeNull();
  });
});
