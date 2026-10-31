-- Notificações push (Web Push): subscrições por dispositivo e registo de envios.
-- Já aplicada na base externa; este ficheiro serve só de registo. Só adições. Reverter:
--   DROP TABLE IF EXISTS public.notification_log;
--   DROP TABLE IF EXISTS public.push_subscriptions;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (char_length(endpoint) BETWEEN 10 AND 1000 AND endpoint LIKE 'https://%'),
  p256dh text NOT NULL CHECK (char_length(p256dh) BETWEEN 20 AND 200),
  auth text NOT NULL CHECK (char_length(auth) BETWEEN 8 AND 100),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.push_subscriptions IS
  'Subscrições Web Push por dispositivo (resumo diário das 9h). A chave privada VAPID fica só no servidor.';
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage their own push subscriptions" ON public.push_subscriptions FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP TRIGGER IF EXISTS update_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER update_push_subscriptions_updated_at BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Um envio por utilizador, tipo e dia: evita resumos repetidos quando o agendamento corre duas vezes.
CREATE TABLE IF NOT EXISTS public.notification_log (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('morning_digest')),
  sent_on date NOT NULL,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, sent_on)
);
COMMENT ON TABLE public.notification_log IS
  'Registo dos resumos enviados (escrito só pela tarefa agendada com a chave de serviço).';

GRANT SELECT ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read their own notification log" ON public.notification_log;
CREATE POLICY "Users read their own notification log" ON public.notification_log FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);
