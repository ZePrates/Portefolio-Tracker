-- Histórico de valor de carteira, para a linha de lucro não realizado nos
-- gráficos de evolução. "scope" identifica a que parte da carteira se
-- refere cada fotografia: 'total' (carteira toda) ou 'class:<classe>'
-- (ex.: 'class:etf') — permite ter histórico de uma fatia específica
-- mesmo sem histórico da carteira toda para o mesmo período (ex.:
-- importação manual de um histórico só de ETFs).
CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  scope text NOT NULL,
  invested_amount numeric NOT NULL DEFAULT 0,
  market_value numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, snapshot_date, scope)
);

CREATE INDEX IF NOT EXISTS portfolio_snapshots_user_scope_date_idx
  ON public.portfolio_snapshots (user_id, scope, snapshot_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_snapshots TO authenticated;
GRANT ALL ON public.portfolio_snapshots TO service_role;
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own portfolio snapshots" ON public.portfolio_snapshots;
CREATE POLICY "Users manage their own portfolio snapshots" ON public.portfolio_snapshots FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP TRIGGER IF EXISTS update_portfolio_snapshots_updated_at ON public.portfolio_snapshots;
CREATE TRIGGER update_portfolio_snapshots_updated_at BEFORE UPDATE ON public.portfolio_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
