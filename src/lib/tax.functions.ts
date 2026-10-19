import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware-external";
import { todayLisbon } from "@/lib/dates";
import { dbError } from "@/lib/errors";
import { annualTaxReport, type InterestRecord, type TaxYearOptions } from "@/lib/tax-report";
import type { YearGains } from "@/lib/tax-rules";
import type { TaxDocument, TaxYearSettings } from "@/integrations/supabase/external-types";
import { isScrambleBonus, type ScrambleCashType } from "@/lib/scramble";

/** Movimentos P2P com relevância fiscal: juros e bónus. */
const P2P_INCOME_TYPES = ["interest", "interest_increased", "bonus_noncash", "bonus_cash"];

/** Resumo fiscal anual (mais-valias FIFO, dividendos, Anexos G/J/E). Só leitura. */
export const getTaxReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        year: z.number().int().min(2000).max(2100),
        /** Taxa marginal de IRS (0..1) para simular o englobamento. */
        marginalRate: z.number().min(0).lt(1).nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const [assetsRes, txRes, divRes, profRes, p2pRes] = await Promise.all([
      sb.from("assets").select("id, name, class, isin, ticker, withholding_rate"),
      sb
        .from("transactions")
        .select("id, asset_id, type, quantity, price, fee, traded_at, created_at"),
      sb
        .from("dividends")
        .select(
          "asset_id, asset_name, amount, gross_amount, tax_amount, net_amount, paid_at, payment_date, payment_date_estimated, status, currency",
        ),
      sb.from("asset_profiles").select("asset_id, domicile_country"),
      sb
        .from("p2p_cash_movements")
        .select("asset_id, occurred_on, type, amount")
        .in("type", P2P_INCOME_TYPES)
        .lte("occurred_on", `${data.year}-12-31`),
    ]);
    const settingsRes = await sb.from("tax_year_settings").select("*");
    for (const r of [assetsRes, txRes, divRes, profRes, p2pRes, settingsRes])
      if (r.error) throw dbError(r.error);
    const domicile = new Map(
      (profRes.data ?? []).map((p) => [p.asset_id, p.domicile_country] as const),
    );
    const assetName = new Map((assetsRes.data ?? []).map((a) => [a.id, a.name] as const));
    // A Scramble (única plataforma P2P suportada) é uma sociedade estónia.
    const interest: InterestRecord[] = (p2pRes.data ?? []).map((m) => ({
      assetId: m.asset_id,
      assetName: assetName.get(m.asset_id) ?? "P2P",
      date: m.occurred_on,
      amount: Number(m.amount),
      country: "EE",
      kind: isScrambleBonus(m.type as ScrambleCashType) ? "bonus" : "interest",
    }));

    const settingsRows = (settingsRes.data ?? []) as TaxYearSettings[];
    const toOptions = (s: TaxYearSettings | undefined): TaxYearOptions => ({
      optedAggregation: !!s?.opted_aggregation,
      taxableIncome: s?.taxable_income == null ? null : Number(s.taxable_income),
      marginalRate: s?.marginal_rate == null ? null : Number(s.marginal_rate),
      manualLossCarryforward: Number(s?.manual_loss_carryforward ?? 0),
    });
    const current = settingsRows.find((s) => s.tax_year === data.year);
    const assets = (assetsRes.data ?? []).map((a) => ({ ...a, domicile: domicile.get(a.id) ?? null }));
    const transactions = (txRes.data ?? []).map((t) => ({
      ...t,
      quantity: Number(t.quantity),
      price: Number(t.price),
      fee: Number(t.fee ?? 0),
    }));
    const today = todayLisbon();
    // Anos anteriores (até 10): saldo tributável e opção de englobamento, para o reporte.
    const priorYears: YearGains[] = [];
    for (let y = data.year - 10; y < data.year; y++) {
      if (!transactions.some((t) => t.type === "sell" && t.traded_at.startsWith(String(y)))) continue;
      const r = annualTaxReport({ year: y, assets, transactions, dividends: [], today });
      priorYears.push({
        year: y,
        taxableNetGains: r.totals.taxableNetGains,
        optedAggregation: !!settingsRows.find((s) => s.tax_year === y)?.opted_aggregation,
      });
    }

    const report = annualTaxReport({
      year: data.year,
      assets,
      transactions,
      dividends: divRes.data ?? [],
      interest,
      today,
      marginalRate: data.marginalRate,
      options: toOptions(current),
      priorYears,
    });
    return { ...report, settings: current ?? null };
  });

const settingsSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  optedAggregation: z.boolean(),
  taxableIncome: z.number().min(0).nullable(),
  marginalRate: z.number().min(0).max(1).nullable(),
  manualLossCarryforward: z.number().min(0),
  notes: z.string().max(2000).nullable(),
});

/** Grava as opções do ano fiscal (upsert por utilizador + ano). */
export const saveTaxYearSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => settingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tax_year_settings").upsert(
      {
        user_id: context.userId,
        tax_year: data.year,
        opted_aggregation: data.optedAggregation,
        taxable_income: data.taxableIncome,
        marginal_rate: data.marginalRate,
        manual_loss_carryforward: data.manualLossCarryforward,
        notes: data.notes,
      },
      { onConflict: "user_id,tax_year" },
    );
    if (error) throw dbError(error);
    return { ok: true };
  });

export const listTaxDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ year: z.number().int().min(2000).max(2100) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tax_documents")
      .select("*")
      .eq("tax_year", data.year)
      .order("created_at", { ascending: true });
    if (error) throw dbError(error);
    return (rows ?? []) as TaxDocument[];
  });

const money = z.number().finite().nullable();
const docSchema = z.object({
  id: z.string().uuid().nullable(),
  year: z.number().int().min(2000).max(2100),
  source: z.enum(["xtb", "scramble", "elementum", "other"]),
  title: z.string().max(200),
  notes: z.string().max(2000).nullable(),
  file: z
    .object({
      path: z.string().min(1).max(500),
      name: z.string().max(300),
      mime: z.string().max(200),
      size: z.number().int().min(0).max(10 * 1024 * 1024),
    })
    .nullable(),
  realization_value: money,
  acquisition_value: money,
  expenses: money,
  net_gains: money,
  dividends_gross: money,
  dividends_tax_withheld: money,
  interest_gross: money,
  interest_tax_withheld: money,
});

/** Cria ou atualiza um relatório oficial (metadados e totais). */
export const saveTaxDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => docSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    if (data.file && !data.file.path.startsWith(`${context.userId}/${data.year}/`)) {
      throw new Error("Caminho do ficheiro inválido.");
    }
    const row = {
      tax_year: data.year,
      source: data.source,
      title: data.title,
      notes: data.notes,
      realization_value: data.realization_value,
      acquisition_value: data.acquisition_value,
      expenses: data.expenses,
      net_gains: data.net_gains,
      dividends_gross: data.dividends_gross,
      dividends_tax_withheld: data.dividends_tax_withheld,
      interest_gross: data.interest_gross,
      interest_tax_withheld: data.interest_tax_withheld,
      ...(data.file
        ? {
            file_path: data.file.path,
            file_name: data.file.name,
            mime_type: data.file.mime,
            file_size: data.file.size,
          }
        : {}),
    };
    if (data.id) {
      let oldPath: string | null = null;
      if (data.file) {
        const prev = await sb.from("tax_documents").select("file_path").eq("id", data.id).maybeSingle();
        oldPath = prev.data?.file_path ?? null;
      }
      const { error } = await sb.from("tax_documents").update(row).eq("id", data.id);
      if (error) throw dbError(error);
      if (oldPath && oldPath !== data.file?.path) {
        await sb.storage.from("tax-documents").remove([oldPath]);
      }
      return { id: data.id };
    }
    const { data: ins, error } = await sb
      .from("tax_documents")
      .insert({ ...row, user_id: context.userId })
      .select("id")
      .single();
    if (error) throw dbError(error);
    return { id: ins.id };
  });

/** Apaga o relatório e o ficheiro guardado. */
export const deleteTaxDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const prev = await sb.from("tax_documents").select("file_path").eq("id", data.id).maybeSingle();
    if (prev.error) throw dbError(prev.error);
    if (prev.data?.file_path) {
      const rm = await sb.storage.from("tax-documents").remove([prev.data.file_path]);
      if (rm.error) throw new Error("Não foi possível apagar o ficheiro guardado.");
    }
    const { error } = await sb.from("tax_documents").delete().eq("id", data.id);
    if (error) throw dbError(error);
    return { ok: true };
  });
