CREATE TABLE IF NOT EXISTS public.dismissed_alerts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_key text NOT NULL CHECK (char_length(alert_key) BETWEEN 1 AND 500),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, alert_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dismissed_alerts TO authenticated;
GRANT ALL ON public.dismissed_alerts TO service_role;
ALTER TABLE public.dismissed_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own dismissed alerts" ON public.dismissed_alerts;
CREATE POLICY "Users manage their own dismissed alerts" ON public.dismissed_alerts FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

CREATE TABLE IF NOT EXISTS public.p2p_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  occurred_on date NOT NULL,
  seq integer NOT NULL DEFAULT 0,
  type text NOT NULL CHECK (type IN ('deposit','withdrawal','purchase','principal','interest','interest_increased','bonus_noncash','bonus_cash','fee','other')),
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  amount numeric(14, 2) NOT NULL,
  balance numeric(14, 2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS p2p_cash_movements_asset_date_idx ON public.p2p_cash_movements (asset_id, occurred_on);
CREATE INDEX IF NOT EXISTS p2p_cash_movements_user_idx ON public.p2p_cash_movements (user_id);

CREATE TABLE IF NOT EXISTS public.p2p_round_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  occurred_on date NOT NULL,
  seq integer NOT NULL DEFAULT 0,
  round_key text NOT NULL CHECK (round_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  opening_principal numeric(14, 2) NOT NULL DEFAULT 0,
  invested numeric(14, 2) NOT NULL DEFAULT 0 CHECK (invested >= 0),
  principal_repaid numeric(14, 2) NOT NULL DEFAULT 0 CHECK (principal_repaid >= 0),
  interest_received numeric(14, 2) NOT NULL DEFAULT 0 CHECK (interest_received >= 0),
  closing_principal numeric(14, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS p2p_round_movements_asset_date_idx ON public.p2p_round_movements (asset_id, occurred_on);
CREATE INDEX IF NOT EXISTS p2p_round_movements_user_idx ON public.p2p_round_movements (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.p2p_cash_movements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.p2p_round_movements TO authenticated;
GRANT ALL ON public.p2p_cash_movements TO service_role;
GRANT ALL ON public.p2p_round_movements TO service_role;
ALTER TABLE public.p2p_cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_round_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own p2p cash movements" ON public.p2p_cash_movements;
CREATE POLICY "Users manage their own p2p cash movements" ON public.p2p_cash_movements FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users manage their own p2p round movements" ON public.p2p_round_movements;
CREATE POLICY "Users manage their own p2p round movements" ON public.p2p_round_movements FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);