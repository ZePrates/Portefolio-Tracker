export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assets: {
        Row: {
          annual_yield: number | null
          average_price: number
          class: string
          closed_at: string | null
          created_at: string
          currency: string
          current_price: number
          current_price_native: number | null
          current_value: number
          dividend_frequency: string | null
          id: string
          invested_amount: number
          last_dividend_import: string | null
          metal_type: string | null
          name: string
          native_currency: string
          notes: string | null
          p2p_group: string | null
          purchase_price_native: number | null
          quantity: number
          realized_pl: number
          status: string
          ticker: string | null
          total_fees: number
          updated_at: string
          user_id: string
        }
        Insert: {
          annual_yield?: number | null
          average_price?: number
          class: string
          closed_at?: string | null
          created_at?: string
          currency?: string
          current_price?: number
          current_price_native?: number | null
          current_value?: number
          dividend_frequency?: string | null
          id?: string
          invested_amount?: number
          last_dividend_import?: string | null
          metal_type?: string | null
          name: string
          native_currency?: string
          notes?: string | null
          p2p_group?: string | null
          purchase_price_native?: number | null
          quantity?: number
          realized_pl?: number
          status?: string
          ticker?: string | null
          total_fees?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          annual_yield?: number | null
          average_price?: number
          class?: string
          closed_at?: string | null
          created_at?: string
          currency?: string
          current_price?: number
          current_price_native?: number | null
          current_value?: number
          dividend_frequency?: string | null
          id?: string
          invested_amount?: number
          last_dividend_import?: string | null
          metal_type?: string | null
          name?: string
          native_currency?: string
          notes?: string | null
          p2p_group?: string | null
          purchase_price_native?: number | null
          quantity?: number
          realized_pl?: number
          status?: string
          ticker?: string | null
          total_fees?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dividends: {
        Row: {
          amount: number
          asset_id: string | null
          asset_name: string
          created_at: string
          id: string
          paid_at: string
          per_share: number | null
          source: string
          user_id: string
        }
        Insert: {
          amount?: number
          asset_id?: string | null
          asset_name?: string
          created_at?: string
          id?: string
          paid_at?: string
          per_share?: number | null
          source?: string
          user_id: string
        }
        Update: {
          amount?: number
          asset_id?: string | null
          asset_name?: string
          created_at?: string
          id?: string
          paid_at?: string
          per_share?: number | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dividends_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          asset_id: string | null
          created_at: string
          fee: number
          fee_native: number | null
          fx_rate: number
          id: string
          native_currency: string
          notes: string | null
          price: number
          price_native: number | null
          quantity: number
          realized_pl: number | null
          source: string
          total: number
          traded_at: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          fee?: number
          fee_native?: number | null
          fx_rate?: number
          id?: string
          native_currency?: string
          notes?: string | null
          price?: number
          price_native?: number | null
          quantity?: number
          realized_pl?: number | null
          source?: string
          total?: number
          traded_at?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          fee?: number
          fee_native?: number | null
          fx_rate?: number
          id?: string
          native_currency?: string
          notes?: string | null
          price?: number
          price_native?: number | null
          quantity?: number
          realized_pl?: number | null
          source?: string
          total?: number
          traded_at?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
