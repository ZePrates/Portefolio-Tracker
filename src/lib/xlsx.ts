/**
 * Leitor mínimo de folhas de cálculo .xlsx (Office Open XML), sem dependências
 * além do descompressor ZIP. Devolve, por folha, as linhas como listas de
 * células em texto (null nas vazias). Chega para extratos de brokers: só lê
 * valores, ignora estilos, fórmulas e datas formatadas (ficam como número de
 * série do Excel — ver `excelSerialToDate`).
 */
import { strFromU8, unzipSync } from "fflate";

export type XlsxSheets = Record<string, Array<Array<string | null>>>;

const ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  amp: "&",
};

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** Texto de um elemento com runs (<r><t>…</t></r>) ou um <t> simples. */
function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join("");
}

/** "AB12" → 27 (índice de coluna a partir de 0). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function resolveTarget(target: string): string {
  const t = target.replace(/^\//, "");
  return t.startsWith("xl/") ? t : `xl/${t}`;
}

export function readXlsx(bytes: Uint8Array): XlsxSheets {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("O ficheiro não é um Excel (.xlsx) válido.");
  }
  const read = (path: string) => {
    const f = files[path];
    return f ? strFromU8(f) : null;
  };
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("O ficheiro não é um Excel (.xlsx) válido.");

  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (m) => textOf(m[1]!),
  );
  const targets = new Map(
    [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => {
      const id = /\bId="([^"]+)"/.exec(m[1]!)?.[1] ?? "";
      const target = /\bTarget="([^"]+)"/.exec(m[1]!)?.[1] ?? "";
      return [id, target] as const;
    }),
  );

  const sheets: XlsxSheets = {};
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(m[1]!)?.[1];
    const target = rid ? targets.get(rid) : undefined;
    const xml = target ? read(resolveTarget(target)) : null;
    if (!name || !xml) continue;
    const rows: Array<Array<string | null>> = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: Array<string | null> = [];
      for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const body = c[2] ?? "";
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        let value: string | null;
        if (type === "inlineStr") value = textOf(body);
        else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          value = v == null ? null : type === "s" ? (shared[Number(v)] ?? null) : decodeXml(v);
        }
        const idx = ref ? columnIndex(ref) : row.length;
        while (row.length < idx) row.push(null);
        row[idx] = value;
      }
      rows.push(row);
    }
    sheets[name] = rows;
  }
  return sheets;
}

/**
 * Número de série do Excel (dias desde 30/12/1899, sistema 1900) → Date em
 * UTC. Os extratos da XTB guardam as horas em UTC neste formato.
 */
export function excelSerialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86_400_000));
}
