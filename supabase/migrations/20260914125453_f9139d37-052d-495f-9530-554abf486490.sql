DROP POLICY IF EXISTS "Users manage their own assets" ON public.assets;
CREATE POLICY "Users manage their own assets" ON public.assets FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage their own transactions" ON public.transactions;
CREATE POLICY "Users manage their own transactions" ON public.transactions FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage their own dividends" ON public.dividends;
CREATE POLICY "Users manage their own dividends" ON public.dividends FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage their own asset expenses" ON public.asset_expenses;
CREATE POLICY "Users manage their own asset expenses" ON public.asset_expenses FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage their own asset profiles" ON public.asset_profiles;
CREATE POLICY "Users manage their own asset profiles" ON public.asset_profiles FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage their own asset exposures" ON public.asset_exposures;
CREATE POLICY "Users manage their own asset exposures" ON public.asset_exposures FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage their own etf holdings" ON public.etf_holdings;
CREATE POLICY "Users manage their own etf holdings" ON public.etf_holdings FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS assets_user_id_idx ON public.assets (user_id);
CREATE INDEX IF NOT EXISTS transactions_user_id_idx ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS asset_expenses_user_id_idx ON public.asset_expenses (user_id);
CREATE INDEX IF NOT EXISTS asset_profiles_user_id_idx ON public.asset_profiles (user_id);
CREATE INDEX IF NOT EXISTS asset_exposures_user_id_idx ON public.asset_exposures (user_id);
CREATE INDEX IF NOT EXISTS etf_holdings_user_id_idx ON public.etf_holdings (user_id);

DROP INDEX IF EXISTS public.transactions_asset_traded_idx;

REVOKE INSERT, UPDATE, DELETE ON public.security_profiles FROM authenticated;
GRANT SELECT ON public.security_profiles TO authenticated;
GRANT ALL ON public.security_profiles TO service_role;