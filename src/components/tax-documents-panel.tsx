import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge, Button, Card, Field, SelectInput, TextArea, TextInput } from "@/components/ui-bits";
import { privateEUR } from "@/components/private-value";
import { deleteTaxDocument, listTaxDocuments, saveTaxDocument } from "@/lib/tax.functions";
import { formatDatePt, parseNumberPt } from "@/lib/format";
import {
  hasOfficialTotals,
  reconcileDocument,
  taxDocPath,
  validateTaxFile,
  type AppSourceTotals,
  type TaxDocSource,
} from "@/lib/tax-rules";
import type { TaxDocument } from "@/integrations/supabase/external-types";

export const SOURCE_LABEL: Record<TaxDocSource, string> = {
  xtb: "XTB",
  scramble: "Scramble",
  elementum: "Elementum",
  other: "Outro",
};

const TOTAL_FIELDS = [
  ["realization_value", "Valor de realização"],
  ["acquisition_value", "Valor de aquisição"],
  ["expenses", "Despesas"],
  ["net_gains", "Saldo de mais-valias"],
  ["dividends_gross", "Dividendos brutos"],
  ["dividends_tax_withheld", "Imposto retido (dividendos)"],
  ["interest_gross", "Juros brutos"],
  ["interest_tax_withheld", "Imposto retido (juros)"],
] as const;
type TotalKey = (typeof TOTAL_FIELDS)[number][0];

const numText = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));

export function useTaxDocuments(year: number) {
  const list = useServerFn(listTaxDocuments);
  return useQuery({ queryKey: ["tax-documents", year], queryFn: () => list({ data: { year } }) });
}

export function TaxDocumentsPanel({
  year,
  appTotals,
  hidden,
  documents,
  onChanged,
}: {
  year: number;
  appTotals: AppSourceTotals;
  hidden: boolean;
  documents: TaxDocument[];
  onChanged: () => void;
}) {
  const remove = useServerFn(deleteTaxDocument);
  const [editing, setEditing] = useState<TaxDocument | "new" | null>(null);

  const open = async (doc: TaxDocument) => {
    if (!doc.file_path) return;
    const { data, error } = await supabase.storage
      .from("tax-documents")
      .createSignedUrl(doc.file_path, 60);
    if (error || !data) return void toast.error("Não foi possível abrir o ficheiro.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const del = async (doc: TaxDocument) => {
    if (
      !window.confirm(`Apagar o relatório "${doc.title || SOURCE_LABEL[doc.source]}" e o ficheiro?`)
    )
      return;
    try {
      await remove({ data: { id: doc.id } });
      toast.success("Relatório apagado.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível apagar.");
    }
  };

  return (
    <section aria-labelledby="irs-docs" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="irs-docs" className="text-base font-semibold">
          Relatórios oficiais {year}
        </h2>
        {editing == null && (
          <Button variant="outline" onClick={() => setEditing("new")}>
            <Plus aria-hidden className="h-4 w-4" />
            Adicionar relatório
          </Button>
        )}
      </div>

      {editing != null && (
        <DocumentForm
          key={editing === "new" ? "new" : editing.id}
          year={year}
          doc={editing === "new" ? null : editing}
          onDone={(changed) => {
            setEditing(null);
            if (changed) onChanged();
          }}
        />
      )}

      {documents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
          Ainda não guardaste relatórios oficiais de {year} (XTB, Scramble, …).
        </p>
      ) : (
        <ul className="space-y-3">
          {documents.map((d) => {
            const rows = hasOfficialTotals(d) ? reconcileDocument(d, appTotals) : [];
            return (
              <li key={d.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <Badge tone="primary">{SOURCE_LABEL[d.source]}</Badge>
                      {d.title || "Sem título"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Carregado a {formatDatePt(d.created_at.slice(0, 10))}
                      {d.file_name ? ` · ${d.file_name}` : " · sem ficheiro"}
                    </p>
                    {d.notes && <p className="mt-1 text-xs text-muted-foreground">{d.notes}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {d.file_path && (
                      <Button
                        variant="ghost"
                        aria-label="Abrir ficheiro"
                        onClick={() => void open(d)}
                      >
                        <FileText aria-hidden className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      aria-label="Editar relatório"
                      onClick={() => setEditing(d)}
                    >
                      <Pencil aria-hidden className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label="Apagar relatório"
                      onClick={() => void del(d)}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {rows.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[32rem] text-sm">
                      <caption className="sr-only">Oficial vs. app</caption>
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          <th className="py-1 text-left font-medium">Oficial vs. app</th>
                          <th className="py-1 text-right font-medium">Oficial</th>
                          <th className="py-1 text-right font-medium">App</th>
                          <th className="py-1 text-right font-medium">Diferença</th>
                          <th className="py-1 text-right font-medium">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {rows.map((r) => (
                          <tr key={r.label}>
                            <td className="py-1.5">{r.label}</td>
                            <td className="num py-1.5 text-right">
                              {privateEUR(r.official, hidden)}
                            </td>
                            <td className="num py-1.5 text-right">
                              {r.app == null ? "—" : privateEUR(r.app, hidden)}
                            </td>
                            <td className="num py-1.5 text-right">
                              {r.diff == null ? "—" : privateEUR(r.diff, hidden)}
                            </td>
                            <td className="py-1.5 text-right">
                              {r.status === "confere" ? (
                                <Badge tone="gain">confere</Badge>
                              ) : r.status === "diverge" ? (
                                <Badge tone="loss">diverge</Badge>
                              ) : (
                                <Badge>sem comparação</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DocumentForm({
  year,
  doc,
  onDone,
}: {
  year: number;
  doc: TaxDocument | null;
  onDone: (changed: boolean) => void;
}) {
  const save = useServerFn(saveTaxDocument);
  const [source, setSource] = useState<TaxDocSource>(doc?.source ?? "xtb");
  const [title, setTitle] = useState(doc?.title ?? "");
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [totals, setTotals] = useState<Record<TotalKey, string>>(
    () =>
      Object.fromEntries(TOTAL_FIELDS.map(([k]) => [k, numText(doc?.[k] ?? null)])) as Record<
        TotalKey,
        string
      >,
  );
  const [saving, setSaving] = useState(false);

  const parsed = Object.fromEntries(
    TOTAL_FIELDS.map(([k]) => [k, totals[k].trim() === "" ? null : parseNumberPt(totals[k])]),
  ) as Record<TotalKey, number | null>;
  const badTotal = TOTAL_FIELDS.some(([k]) => parsed[k] != null && !Number.isFinite(parsed[k]));

  const onFile = (f: File | null) => {
    setFile(null);
    setFileErr(null);
    if (!f) return;
    const v = validateTaxFile(f);
    if (!v.ok) return setFileErr(v.error);
    setFile(f);
  };

  const submit = async () => {
    if (badTotal || fileErr) return;
    setSaving(true);
    let uploaded: { path: string; name: string; mime: string; size: number } | null = null;
    try {
      if (file) {
        const v = validateTaxFile(file);
        if (!v.ok) throw new Error(v.error);
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error("Sessão expirada: volta a entrar.");
        const path = taxDocPath(u.user.id, year, crypto.randomUUID(), file.name);
        const up = await supabase.storage
          .from("tax-documents")
          .upload(path, file, { contentType: v.mime, upsert: false });
        if (up.error) throw new Error("Não foi possível carregar o ficheiro.");
        uploaded = { path, name: file.name.slice(0, 300), mime: v.mime, size: file.size };
      }
      await save({
        data: {
          id: doc?.id ?? null,
          year,
          source,
          title: title.trim().slice(0, 200),
          notes: notes.trim() === "" ? null : notes.trim(),
          file: uploaded,
          ...parsed,
        },
      });
      toast.success(doc ? "Relatório atualizado." : "Relatório guardado.");
      onDone(true);
    } catch (e) {
      if (uploaded) await supabase.storage.from("tax-documents").remove([uploaded.path]);
      toast.error(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold">
        {doc ? "Editar relatório" : "Adicionar relatório"}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Fonte">
          <SelectInput value={source} onChange={(e) => setSource(e.target.value as TaxDocSource)}>
            {(Object.keys(SOURCE_LABEL) as TaxDocSource[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Título">
          <TextInput
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`ex.: Relatório fiscal ${year}`}
          />
        </Field>
        <Field
          label={doc?.file_name ? `Substituir ficheiro (${doc.file_name})` : "Ficheiro (opcional)"}
          error={fileErr}
          hint="PDF, CSV, XLS ou XLSX, até 10 MB."
        >
          <input
            type="file"
            accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-secondary-foreground"
          />
        </Field>
      </div>
      <p className="mt-4 mb-2 text-xs font-medium text-muted-foreground">
        Totais do relatório (opcional, em €)
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TOTAL_FIELDS.map(([k, label]) => (
          <Field
            key={k}
            label={label}
            error={
              parsed[k] != null && !Number.isFinite(parsed[k]) ? "Número inválido." : undefined
            }
          >
            <TextInput
              inputMode="decimal"
              autoComplete="off"
              value={totals[k]}
              onChange={(e) => setTotals((t) => ({ ...t, [k]: e.target.value }))}
              placeholder="0,00"
            />
          </Field>
        ))}
      </div>
      <Field label="Notas" className="mt-4">
        <TextArea
          rows={2}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(false)} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={() => void submit()} disabled={saving || badTotal || !!fileErr}>
          {saving ? "A guardar…" : "Guardar"}
        </Button>
      </div>
    </Card>
  );
}
