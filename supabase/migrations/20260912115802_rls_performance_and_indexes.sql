-- Otimizações de performance identificadas pelo Supabase Advisor:
-- 1) Políticas RLS reavaliavam auth.uid() por linha; (select auth.uid())
--    é avaliado uma vez por query (initplan), escala muito melhor.
-- 2) Faltavam índices em user_id, usado em todas as políticas de RLS e
--    em praticamente todas as queries da app.
-- 3) transactions tinha dois índices idênticos (asset_id, traded_at, created_at).

-- ---- RLS: (select auth.uid()) em vez de auth.uid() ----
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

-- ---- Índices em falta em user_id (cobrem as FKs e aceleram RLS) ----
CREATE INDEX IF NOT EXISTS assets_user_id_idx ON public.assets (user_id);
CREATE INDEX IF NOT EXISTS transactions_user_id_idx ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS asset_expenses_user_id_idx ON public.asset_expenses (user_id);
CREATE INDEX IF NOT EXISTS asset_profiles_user_id_idx ON public.asset_profiles (user_id);
CREATE INDEX IF NOT EXISTS asset_exposures_user_id_idx ON public.asset_exposures (user_id);
CREATE INDEX IF NOT EXISTS etf_holdings_user_id_idx ON public.etf_holdings (user_id);

-- ---- Remove o índice duplicado em transactions ----
DROP INDEX IF EXISTS public.transactions_asset_traded_idx;
