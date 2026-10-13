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

type ExternalTables = {
  [Name in keyof GeneratedDatabase["public"]["Tables"]]:
    Name extends keyof ExtraColumns
      ? Omit<GeneratedDatabase["public"]["Tables"][Name], "Row" | "Insert" | "Update"> & {
          Row: GeneratedDatabase["public"]["Tables"][Name]["Row"] & ExtraColumns[Name];
          Insert: GeneratedDatabase["public"]["Tables"][Name]["Insert"] & Partial<ExtraColumns[Name]>;
          Update: GeneratedDatabase["public"]["Tables"][Name]["Update"] & Partial<ExtraColumns[Name]>;
        }
      : GeneratedDatabase["public"]["Tables"][Name];
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Tables"> & { Tables: ExternalTables };
};

export type { Json } from "./types";