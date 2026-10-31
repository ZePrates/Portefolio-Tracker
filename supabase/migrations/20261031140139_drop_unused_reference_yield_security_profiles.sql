-- Limpeza (30/10/2026, confirmada pelo utilizador):
-- * assets.reference_yield / reference_yield_at: yield do Finnhub (#78), sem uso desde #80
--   (o yield passou a vir dos dividendos recebidos).
-- * security_profiles: 0 linhas e nenhum código a usa.
alter table public.assets
  drop column if exists reference_yield,
  drop column if exists reference_yield_at;
drop table if exists public.security_profiles;
