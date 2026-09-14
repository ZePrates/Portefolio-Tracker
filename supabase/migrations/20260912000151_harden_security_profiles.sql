-- security_profiles is a shared reference/cache table, not user-owned data.
-- Authenticated users may read it, but writes must go through trusted server-side code.
DROP POLICY IF EXISTS "Authenticated can insert security profiles" ON public.security_profiles;
DROP POLICY IF EXISTS "Authenticated can update security profiles" ON public.security_profiles;
REVOKE INSERT, UPDATE ON public.security_profiles FROM authenticated;
GRANT INSERT, UPDATE ON public.security_profiles TO service_role;
