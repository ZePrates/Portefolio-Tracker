-- Migração-base retroativa.
--
-- As tabelas assets, transactions, dividends e asset_expenses já existiam em
-- produção antes de este repositório começar a versionar migrações (a mais
-- antiga rastreada, 20260903131116, já pressupõe `assets` existente via FK).
-- Este ficheiro documenta esse estado inicial para que `supabase db reset`
-- consiga reconstruir o ambiente do zero. É 100% idempotente (seguro correr
-- num ambiente novo OU no ambiente atual, onde tudo isto já existe).

-- ============================================================= assets ====
CREATE TABLE IF NOT EXISTS public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  class text NOT NULL CHECK (class = ANY (ARRAY['etf','reit','acao_dividendo','acao_crescimento','metal','p2p'])),
  ticker text,
  name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  average_price numeric NOT NULL DEFAULT 0,
  current_price numeric NOT NULL DEFAULT 0,
  invested_amount numeric NOT NULL DEFAULT 0,
  current_value numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  metal_type text,
  p2p_group text,
  annual_yield numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  native_currency text NOT NULL DEFAULT 'EUR',
  purchase_price_native numeric,
  current_price_native numeric,
  dividend_frequency text,
  last_dividend_import timestamptz,
  status text NOT NULL DEFAULT 'open',
  realized_pl numeric NOT NULL DEFAULT 0,
  total_fees numeric NOT NULL DEFAULT 0,
  closed_at timestamptz,
  last_dividend_sync timestamptz,
  price_source text,
  price_updated_at timestamptz,
  fx_rate numeric,
  fx_updated_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own assets" ON public.assets;
CREATE POLICY "Users manage their own assets" ON public.assets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_assets_updated_at ON public.assets;
CREATE TRIGGER update_assets_updated_at BEFORE UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ======================================================= transactions ====
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type = ANY (ARRAY['buy','sell'])),
  quantity numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  traded_at date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  fee numeric NOT NULL DEFAULT 0,
  fee_native numeric,
  native_currency text NOT NULL DEFAULT 'EUR',
  price_native numeric,
  fx_rate numeric NOT NULL DEFAULT 1,
  realized_pl numeric,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  lot_breakdown jsonb
);

CREATE INDEX IF NOT EXISTS transactions_asset_id_idx ON public.transactions (asset_id, traded_at, created_at);
CREATE INDEX IF NOT EXISTS transactions_asset_traded_idx ON public.transactions (asset_id, traded_at, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own transactions" ON public.transactions;
CREATE POLICY "Users manage their own transactions" ON public.transactions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_transactions_updated_at ON public.transactions;
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========================================================== dividends ====
CREATE TABLE IF NOT EXISTS public.dividends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  asset_name text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  paid_at date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',
  per_share numeric,
  ex_date date,
  record_date date,
  payment_date date,
  currency text NOT NULL DEFAULT 'EUR',
  per_share_native numeric,
  amount_native numeric,
  fx_rate numeric NOT NULL DEFAULT 1,
  fx_date date,
  gross_amount numeric,
  tax_amount numeric NOT NULL DEFAULT 0,
  fee_amount numeric NOT NULL DEFAULT 0,
  net_amount numeric,
  eligible_quantity numeric,
  source_event_id text,
  status text NOT NULL DEFAULT 'received' CHECK (status = ANY (ARRAY['received','scheduled','unknown'])),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dividends_asset_idx ON public.dividends (asset_id);
CREATE UNIQUE INDEX IF NOT EXISTS dividends_unique_asset_exdate
  ON public.dividends (user_id, asset_id, ex_date) WHERE (asset_id IS NOT NULL AND ex_date IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS dividends_unique_auto
  ON public.dividends (user_id, asset_id, paid_at) WHERE (asset_id IS NOT NULL AND source = 'yahoo');
CREATE UNIQUE INDEX IF NOT EXISTS dividends_unique_source_event
  ON public.dividends (user_id, asset_id, source, source_event_id) WHERE (source_event_id IS NOT NULL AND asset_id IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dividends TO authenticated;
GRANT ALL ON public.dividends TO service_role;
ALTER TABLE public.dividends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own dividends" ON public.dividends;
CREATE POLICY "Users manage their own dividends" ON public.dividends FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_dividends_updated_at ON public.dividends;
CREATE TRIGGER update_dividends_updated_at BEFORE UPDATE ON public.dividends FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====================================================== asset_expenses ===
CREATE TABLE IF NOT EXISTS public.asset_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'storage',
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  amount_native numeric,
  fx_rate numeric NOT NULL DEFAULT 1,
  incurred_at date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_expenses_asset_idx ON public.asset_expenses (asset_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_expenses TO authenticated;
GRANT ALL ON public.asset_expenses TO service_role;
ALTER TABLE public.asset_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own asset expenses" ON public.asset_expenses;
CREATE POLICY "Users manage their own asset expenses" ON public.asset_expenses FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_asset_expenses_updated_at ON public.asset_expenses;
CREATE TRIGGER update_asset_expenses_updated_at BEFORE UPDATE ON public.asset_expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
