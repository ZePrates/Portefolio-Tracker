import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button, Card, Field, TextArea, TextInput } from "@/components/ui-bits";
import { saveTaxYearSettings } from "@/lib/tax.functions";
import { parseNumberPt } from "@/lib/format";
import type { TaxYearSettings } from "@/integrations/supabase/external-types";

const toText = (n: number | null | undefined, decimals = 2) =>
  n == null ? "" : String(Number(n.toFixed(decimals))).replace(".", ",");

/** Campo opcional: "" → null; inválido → NaN. */
const parseOpt = (s: string) => (s.trim() === "" ? null : parseNumberPt(s));

/** Painel "Opções do ano fiscal" — grava em tax_year_settings (upsert por ano). */
export function TaxYearOptionsPanel({
  year,
  settings,
  onSaved,
}: {
  year: number;
  settings: TaxYearSettings | null;
  onSaved: () => void;
}) {
  const save = useServerFn(saveTaxYearSettings);
  const [income, setIncome] = useState(toText(settings?.taxable_income));
  const [rate, setRate] = useState(
    settings?.marginal_rate == null ? "" : toText(Number(settings.marginal_rate) * 100, 2),
  );
  const [opted, setOpted] = useState(!!settings?.opted_aggregation);
  const [manual, setManual] = useState(toText(settings?.manual_loss_carryforward || null));
  const [notes, setNotes] = useState(settings?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const incomeN = parseOpt(income);
  const rateN = parseOpt(rate);
  const manualN = parseOpt(manual);
  const incomeErr =
    incomeN != null && !(incomeN >= 0) ? "Indica um valor em euros (ex.: 45 000)." : undefined;
  const rateErr =
    rateN != null && !(rateN >= 0 && rateN < 100)
      ? "Indica a taxa marginal entre 0 e 100 (ex.: 35,5)."
      : undefined;
  const manualErr = manualN != null && !(manualN >= 0) ? "Indica um valor positivo." : undefined;
  const invalid = !!(incomeErr || rateErr || manualErr);

  const submit = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      await save({
        data: {
          year,
          optedAggregation: opted,
          taxableIncome: incomeN,
          marginalRate: rateN == null ? null : rateN / 100,
          manualLossCarryforward: manualN ?? 0,
          notes: notes.trim() === "" ? null : notes.trim(),
        },
      });
      toast.success(`Opções de ${year} guardadas.`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold">Opções do ano fiscal {year}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field
          label="Rendimento coletável (€)"
          error={incomeErr}
          hint="Para verificar o englobamento obrigatório."
        >
          <TextInput
            inputMode="decimal"
            autoComplete="off"
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            placeholder="ex.: 45 000"
          />
        </Field>
        <Field label="Taxa marginal de IRS (%)" error={rateErr} hint="Para simular o englobamento.">
          <TextInput
            inputMode="decimal"
            autoComplete="off"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="ex.: 35,5"
          />
        </Field>
        <Field
          label="Menos-valias de anos anteriores (€)"
          error={manualErr}
          hint="Perdas reportáveis não registadas na app."
        >
          <TextInput
            inputMode="decimal"
            autoComplete="off"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="0,00"
          />
        </Field>
        <div className="flex flex-col justify-center">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
            <button
              type="button"
              role="switch"
              aria-checked={opted}
              onClick={() => setOpted((v) => !v)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                opted ? "bg-primary" : "bg-secondary"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all ${
                  opted ? "left-[1.375rem]" : "left-0.5"
                }`}
              />
            </button>
            Optar pelo englobamento
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            Engloba mais-valias, dividendos e juros à taxa marginal.
          </p>
        </div>
      </div>
      <Field label="Notas" className="mt-4">
        <TextArea
          rows={2}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="mt-3 flex justify-end">
        <Button onClick={() => void submit()} disabled={invalid || saving}>
          {saving ? "A guardar…" : "Guardar opções"}
        </Button>
      </div>
    </Card>
  );
}
