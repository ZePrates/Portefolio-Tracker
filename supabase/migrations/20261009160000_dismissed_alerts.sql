-- Avisos de qualidade de dados que o utilizador dispensou no dashboard.
-- alert_key = código|ativo|mensagem: se a mensagem mudar, o aviso volta a aparecer.
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
