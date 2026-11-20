-- Watchlist de ações e REITs (página Avaliação): símbolo do Yahoo, preço-alvo e notas.
-- Já aplicada na base externa; este ficheiro serve só de registo. Só adições. Reverter:
--   DROP TABLE IF EXISTS public.watchlist;

CREATE TABLE IF NOT EXISTS public.watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 24 AND symbol ~ '^[A-Z0-9.^=&-]+$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  target_price numeric CHECK (target_price IS NULL OR target_price > 0),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watchlist_user_symbol_key UNIQUE (user_id, symbol)
);
COMMENT ON TABLE public.watchlist IS
  'Watchlist de ações e REITs (página Avaliação). Preço-alvo na moeda da cotação; o resumo das 9h avisa quando o fecho fica abaixo do alvo.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO authenticated;
GRANT ALL ON public.watchlist TO service_role;
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read their own watchlist" ON public.watchlist;
CREATE POLICY "Users read their own watchlist" ON public.watchlist FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users add to their own watchlist" ON public.watchlist;
CREATE POLICY "Users add to their own watchlist" ON public.watchlist FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users update their own watchlist" ON public.watchlist;
CREATE POLICY "Users update their own watchlist" ON public.watchlist FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users remove from their own watchlist" ON public.watchlist;
CREATE POLICY "Users remove from their own watchlist" ON public.watchlist FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);
