-- Perfil de risco (Objetivos → Perfil de risco): respostas ao questionário e pressupostos
-- do modelo média-variância, uma linha por utilizador.
-- Já aplicada na base externa; este ficheiro serve só de registo. Só adições. Reverter:
--   DROP TABLE IF EXISTS public.investor_profiles;

CREATE TABLE IF NOT EXISTS public.investor_profiles (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(answers) = 'object' AND pg_column_size(answers) <= 2000),
  risk_free_pct numeric NOT NULL DEFAULT 2 CHECK (risk_free_pct >= -5 AND risk_free_pct <= 20),
  outside_cash numeric NOT NULL DEFAULT 0 CHECK (outside_cash >= 0 AND outside_cash < 1000000000),
  expected_return_pct numeric
    CHECK (expected_return_pct IS NULL OR (expected_return_pct > -50 AND expected_return_pct < 50)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.investor_profiles IS
  'Perfil de risco: respostas ao questionário (índice da opção por pergunta), taxa sem risco, liquidez fora da carteira e retorno esperado opcional.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.investor_profiles TO authenticated;
GRANT ALL ON public.investor_profiles TO service_role;
ALTER TABLE public.investor_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own investor profile" ON public.investor_profiles;
CREATE POLICY "Users manage their own investor profile" ON public.investor_profiles FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP TRIGGER IF EXISTS update_investor_profiles_updated_at ON public.investor_profiles;
CREATE TRIGGER update_investor_profiles_updated_at BEFORE UPDATE ON public.investor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
