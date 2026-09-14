CREATE TABLE IF NOT EXISTS public.asset_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  official_name text,
  isin text,
  asset_type text,
  currency text,
  domicile_country text,
  index_tracked text,
  holdings_count integer,
  dividend_yield numeric,
  distribution_frequency text,
  category text,
  fund_family text,
  source text,
  as_of_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_profiles TO authenticated;
GRANT ALL ON public.asset_profiles TO service_role;
ALTER TABLE public.asset_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own asset profiles" ON public.asset_profiles;
CREATE POLICY "Users manage their own asset profiles"
ON public.asset_profiles
FOR ALL TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS update_asset_profiles_updated_at ON public.asset_profiles;
CREATE TRIGGER update_asset_profiles_updated_at
BEFORE UPDATE ON public.asset_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE IF NOT EXISTS public.asset_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  dimension text NOT NULL,
  value text NOT NULL,
  weight numeric NOT NULL DEFAULT 0,
  source text,
  as_of_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, dimension, value, as_of_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_exposures TO authenticated;
GRANT ALL ON public.asset_exposures TO service_role;
ALTER TABLE public.asset_exposures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own asset exposures" ON public.asset_exposures;
CREATE POLICY "Users manage their own asset exposures"
ON public.asset_exposures
FOR ALL TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS update_asset_exposures_updated_at ON public.asset_exposures;
CREATE TRIGGER update_asset_exposures_updated_at
BEFORE UPDATE ON public.asset_exposures
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_asset_exposures_asset
ON public.asset_exposures (asset_id, dimension);


CREATE TABLE IF NOT EXISTS public.etf_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  holding_name text NOT NULL,
  holding_symbol text,
  weight numeric NOT NULL DEFAULT 0,
  country text,
  sector text,
  currency text,
  as_of_date date,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, holding_name, as_of_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.etf_holdings TO authenticated;
GRANT ALL ON public.etf_holdings TO service_role;
ALTER TABLE public.etf_holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own etf holdings" ON public.etf_holdings;
CREATE POLICY "Users manage their own etf holdings"
ON public.etf_holdings
FOR ALL TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS update_etf_holdings_updated_at ON public.etf_holdings;
CREATE TRIGGER update_etf_holdings_updated_at
BEFORE UPDATE ON public.etf_holdings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_etf_holdings_asset
ON public.etf_holdings (asset_id, as_of_date);


CREATE TABLE IF NOT EXISTS public.security_profiles (
  symbol text PRIMARY KEY,
  name text,
  country text,
  sector text,
  industry text,
  currency text,
  source text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.security_profiles TO authenticated;
GRANT ALL ON public.security_profiles TO service_role;
ALTER TABLE public.security_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read security profiles"
ON public.security_profiles;

DROP POLICY IF EXISTS "Authenticated can insert security profiles"
ON public.security_profiles;

DROP POLICY IF EXISTS "Authenticated can update security profiles"
ON public.security_profiles;

CREATE POLICY "Authenticated can read security profiles"
ON public.security_profiles
FOR SELECT TO authenticated
USING (true);

DROP TRIGGER IF EXISTS update_security_profiles_updated_at
ON public.security_profiles;

CREATE TRIGGER update_security_profiles_updated_at
BEFORE UPDATE ON public.security_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
