-- Suporte a arquitetura de fornecedores de composição de ETFs
-- (fonte oficial da gestora → especializado → Yahoo).
--
-- Aditivo e idempotente: não apaga nem altera dados existentes.

-- ISIN por holding, quando a fonte o disponibiliza.
ALTER TABLE public.etf_holdings ADD COLUMN IF NOT EXISTS isin text;

-- Gestora normalizada (para encaminhar para o fornecedor certo) e referência
-- de produto já resolvida na fonte oficial (cache — evita repetir a
-- pesquisa do ISIN no site da gestora em cada sincronização).
ALTER TABLE public.asset_profiles ADD COLUMN IF NOT EXISTS manager_slug text;
ALTER TABLE public.asset_profiles ADD COLUMN IF NOT EXISTS provider_ref jsonb;

COMMENT ON COLUMN public.asset_profiles.manager_slug IS
  'Gestora normalizada para encaminhamento de fornecedor: ishares, vanguard, vaneck, wisdomtree, xtrackers, bnpparibas, ou null se desconhecida/não suportada.';
COMMENT ON COLUMN public.asset_profiles.provider_ref IS
  'Referência de produto já resolvida na fonte oficial (ex.: {"productId":"251882","locale":"uk","slug":"..."}), para não repetir a pesquisa por ISIN a cada sincronização.';
