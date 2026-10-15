import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button, Card } from "@/components/ui-bits";
import { usePrivateMode } from "@/components/private-mode";
import { importSnapshotHistory } from "@/lib/snapshots.functions";
import { parseHistoryCsv, type HistoryParse } from "@/lib/snapshot-import";
import { todayISO } from "@/lib/dashboard";
import { formatDatePt } from "@/lib/format";
import { privateEUR } from "@/components/private-value";

const MAX_BYTES = 1024 * 1024;

/** Importa histórico mensal de ETFs (data;investido;valor) para as fotografias da carteira. */
export function HistoryImportCard() {
  const { hidden } = usePrivateMode();
  const inputId = useId();
  const queryClient = useQueryClient();
  const importFn = useServerFn(importSnapshotHistory);
  const [parsed, setParsed] = useState<HistoryParse | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const read = async (file: File) => {
    setFileName(file.name);
    if (file.size > MAX_BYTES) {
      setParsed({ rows: [], errors: ["Ficheiro demasiado grande (máximo 1 MB)."] });
      return;
    }
    setParsed(parseHistoryCsv(await file.text(), todayISO()));
  };

  const save = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setSaving(true);
    try {
      const r = await importFn({ data: { scope: "class:etf", rows: parsed.rows } });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-snapshots"] });
      toast.success(
        `${r.imported} meses importados` +
          (r.skipped
            ? ` · ${r.skipped} ignorados (já há fotografia da app ou do histórico reconstruído nesse dia)`
            : "") +
          ".",
      );
      setParsed(null);
      setFileName(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível importar o histórico.");
    } finally {
      setSaving(false);
    }
  };

  const rows = parsed?.rows ?? [];
  const first = rows[0];
  const last = rows.at(-1);

  return (
    <Card
      title="Histórico mensal dos ETFs"
      description="Para teres a linha da carteira desde o início nos gráficos de Desempenho. CSV com uma linha por mês: data;investido;valor (ex.: 19/05/2025;4768,87;5199,68). Não substitui fotografias que a app já guardou nem o histórico reconstruído (acima), que é mais exato."
    >
      <label
        htmlFor={inputId}
        className="flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-border px-6 py-6 text-center text-sm font-medium transition-colors hover:bg-accent/40"
      >
        {fileName ?? "Escolher CSV"}
        <input
          id={inputId}
          type="file"
          accept=".csv,.txt,text/csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = "";
          }}
        />
      </label>

      {parsed && (
        <div className="mt-4 space-y-3 text-sm">
          {first && last && (
            <p>
              {rows.length} meses, de {formatDatePt(first.date)} a {formatDatePt(last.date)} ·
              último valor {privateEUR(last.value, hidden)} com {privateEUR(last.invested, hidden)}{" "}
              investidos.
            </p>
          )}
          {parsed.errors.length > 0 && (
            <ul role="alert" className="list-disc pl-5 text-destructive">
              {parsed.errors.slice(0, 5).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {parsed.errors.length > 5 && <li>… e mais {parsed.errors.length - 5}.</li>}
            </ul>
          )}
          <Button onClick={() => void save()} loading={saving} disabled={rows.length === 0}>
            Importar {rows.length} meses
          </Button>
        </div>
      )}
    </Card>
  );
}
