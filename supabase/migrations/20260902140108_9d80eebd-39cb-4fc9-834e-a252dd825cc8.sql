ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS price_source text,
  ADD COLUMN IF NOT EXISTS price_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS fx_rate numeric,
  ADD COLUMN IF NOT EXISTS fx_updated_at timestamptz;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_expenses TO authenticated;
GRANT ALL ON public.asset_expenses TO service_role;

ALTER TABLE public.asset_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own asset expenses" ON public.asset_expenses;
CREATE POLICY "Users manage their own asset expenses" ON public.asset_expenses
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS asset_expenses_asset_idx ON public.asset_expenses(asset_id);

DROP TRIGGER IF EXISTS update_asset_expenses_updated_at ON public.asset_expenses;
CREATE TRIGGER update_asset_expenses_updated_at
  BEFORE UPDATE ON public.asset_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();