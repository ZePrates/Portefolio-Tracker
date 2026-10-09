-- Alinha a base gerida com as migrations do repositório: só adições, nada é apagado.
-- (as colunas/tabelas abaixo já existiam apenas na base externa; os tipos gerados
--  eram regenerados a partir desta base e ficaram sem elas.)

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS withholding_rate numeric
  CHECK (withholding_rate IS NULL OR (withholding_rate >= 0 AND withholding_rate < 1));
COMMENT ON COLUMN public.assets.withholding_rate IS
  'Retenção na fonte dos dividendos (fração 0..1). NULL = por omissão do país de domicílio.';

ALTER TABLE public.dividends ADD COLUMN IF NOT EXISTS payment_date_estimated boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.dividends.payment_date_estimated IS
  'true quando payment_date é uma estimativa (ex-date + desfasamento), não a data confirmada.';

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS fx_source text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source_event_id text;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_source_event_uniq
  ON public.transactions (user_id, source_event_id) WHERE source_event_id IS NOT NULL;

-- Alocação-alvo (core-satellite): scope 'class' (key = classe) ou 'asset' (key = assets.id).
CREATE TABLE IF NOT EXISTS public.allocation_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('class', 'asset')),
  key text NOT NULL,
  target_pct numeric NOT NULL CHECK (target_pct >= 0 AND target_pct <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allocation_targets TO authenticated;
GRANT ALL ON public.allocation_targets TO service_role;
ALTER TABLE public.allocation_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own allocation targets" ON public.allocation_targets;
CREATE POLICY "Users manage their own allocation targets" ON public.allocation_targets FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP TRIGGER IF EXISTS update_allocation_targets_updated_at ON public.allocation_targets;
CREATE TRIGGER update_allocation_targets_updated_at BEFORE UPDATE ON public.allocation_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Objetivo FIRE: uma linha por utilizador.
CREATE TABLE IF NOT EXISTS public.fire_settings (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  annual_expenses numeric NOT NULL CHECK (annual_expenses > 0),
  safe_withdrawal_rate numeric NOT NULL DEFAULT 4 CHECK (safe_withdrawal_rate > 0 AND safe_withdrawal_rate <= 10),
  monthly_contribution numeric NOT NULL DEFAULT 0 CHECK (monthly_contribution >= 0),
  expected_return_pct numeric NOT NULL DEFAULT 5 CHECK (expected_return_pct > -50 AND expected_return_pct < 50),
  inflation_pct numeric NOT NULL DEFAULT 2 CHECK (inflation_pct > -10 AND inflation_pct < 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fire_settings TO authenticated;
GRANT ALL ON public.fire_settings TO service_role;
ALTER TABLE public.fire_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own fire settings" ON public.fire_settings;
CREATE POLICY "Users manage their own fire settings" ON public.fire_settings FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP TRIGGER IF EXISTS update_fire_settings_updated_at ON public.fire_settings;
CREATE TRIGGER update_fire_settings_updated_at BEFORE UPDATE ON public.fire_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- security_profiles deixa de estar aberta a qualquer utilizador autenticado:
-- cada utilizador só vê os perfis dos títulos que efetivamente detém.
-- (Continua a ser alimentada apenas pela service role, que ignora estas regras.)
DROP POLICY IF EXISTS "Authenticated can read security profiles" ON public.security_profiles;
CREATE POLICY "Authenticated can read security profiles"
ON public.security_profiles FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.assets a
    WHERE a.user_id = (SELECT auth.uid())
      AND a.ticker IS NOT NULL
      AND upper(a.ticker) = upper(security_profiles.symbol)
  )
);