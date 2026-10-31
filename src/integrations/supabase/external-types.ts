import type { Database as GeneratedDatabase } from "./types";

/** Columns already used by the external database; never modify generated Cloud types. */
type ExtraColumns = {
  assets: {
    buyback_discount: number | null;
    custodian: string | null;
    plan_name: string | null;
    vault_ref: string | null;
  };
  transactions: { premium_rate: number | null };
  asset_expenses: { grams_deducted: number; price_per_gram: number | null };
};

type TaxDocumentRow = {
  id: string;
  user_id: string;
  tax_year: number;
  source: "xtb" | "scramble" | "elementum" | "other";
  title: string;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  realization_value: number | null;
  acquisition_value: number | null;
  expenses: number | null;
  net_gains: number | null;
  dividends_gross: number | null;
  dividends_tax_withheld: number | null;
  interest_gross: number | null;
  interest_tax_withheld: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type TaxYearSettingsRow = {
  user_id: string;
  tax_year: number;
  opted_aggregation: boolean;
  taxable_income: number | null;
  marginal_rate: number | null;
  manual_loss_carryforward: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
};

type NotificationLogRow = {
  user_id: string;
  kind: "morning_digest";
  sent_on: string;
  summary: import("./types").Json | null;
  created_at: string;
};

/** Tables that exist only in the external database. */
type ExtraTables = {
  tax_documents: {
    Row: TaxDocumentRow;
    Insert: Partial<TaxDocumentRow> & { tax_year: number; source: TaxDocumentRow["source"] };
    Update: Partial<TaxDocumentRow>;
    Relationships: [];
  };
  tax_year_settings: {
    Row: TaxYearSettingsRow;
    Insert: Partial<TaxYearSettingsRow> & { tax_year: number };
    Update: Partial<TaxYearSettingsRow>;
    Relationships: [];
  };
  push_subscriptions: {
    Row: PushSubscriptionRow;
    Insert: Partial<PushSubscriptionRow> &
      Pick<PushSubscriptionRow, "endpoint" | "p256dh" | "auth">;
    Update: Partial<PushSubscriptionRow>;
    Relationships: [];
  };
  notification_log: {
    Row: NotificationLogRow;
    Insert: Partial<NotificationLogRow> & Pick<NotificationLogRow, "user_id" | "kind" | "sent_on">;
    Update: Partial<NotificationLogRow>;
    Relationships: [];
  };
};

type ExternalTables = {
  [Name in keyof GeneratedDatabase["public"]["Tables"]]: Name extends keyof ExtraColumns
    ? Omit<GeneratedDatabase["public"]["Tables"][Name], "Row" | "Insert" | "Update"> & {
        Row: GeneratedDatabase["public"]["Tables"][Name]["Row"] & ExtraColumns[Name];
        Insert: GeneratedDatabase["public"]["Tables"][Name]["Insert"] & Partial<ExtraColumns[Name]>;
        Update: GeneratedDatabase["public"]["Tables"][Name]["Update"] & Partial<ExtraColumns[Name]>;
      }
    : GeneratedDatabase["public"]["Tables"][Name];
} & ExtraTables;

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Tables"> & { Tables: ExternalTables };
};

export type TaxDocument = TaxDocumentRow;
export type TaxYearSettings = TaxYearSettingsRow;
export type { Json } from "./types";
