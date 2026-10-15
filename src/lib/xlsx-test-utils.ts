/** Só para testes: constrói um .xlsx mínimo com as folhas indicadas. */
import { strToU8, zipSync } from "fflate";

export function buildXlsx(sheets: Record<string, string>, shared: string[] = []): Uint8Array {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(
      `<workbook xmlns:r="r"><sheets>${names
        .map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships>${names
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="ws" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("")}</Relationships>`,
    ),
    "xl/sharedStrings.xml": strToU8(
      `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`,
    ),
  };
  names.forEach((n, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<worksheet><sheetData>${sheets[n]}</sheetData></worksheet>`,
    );
  });
  return zipSync(files);
}
