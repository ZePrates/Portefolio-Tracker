-- Consolidação dos índices únicos de dividends (F14, AUDITORIA-CODIGO.md 4.4).
-- Ficam dividends_source_event_uniq (user_id, source, source_event_id) e
-- dividends_asset_exdate_source_uniq (user_id, asset_id, ex_date, source).
-- Os três abaixo sobrepõem-se a esses; dividends_unique_auto impedia ainda duas
-- distribuições do mesmo ativo pagas no mesmo dia. Não há upserts em dividends
-- que dependam destes índices (onConflict). Não apaga dados.
--
-- Reverter:
--   CREATE UNIQUE INDEX dividends_unique_auto ON public.dividends (user_id, asset_id, paid_at)
--     WHERE asset_id IS NOT NULL AND source = 'yahoo';
--   CREATE UNIQUE INDEX dividends_unique_source_event ON public.dividends (user_id, asset_id, source, source_event_id)
--     WHERE source_event_id IS NOT NULL AND asset_id IS NOT NULL;
--   CREATE UNIQUE INDEX dividends_unique_asset_exdate ON public.dividends (user_id, asset_id, ex_date)
--     WHERE asset_id IS NOT NULL AND ex_date IS NOT NULL;

DROP INDEX IF EXISTS public.dividends_unique_auto;
DROP INDEX IF EXISTS public.dividends_unique_source_event;
DROP INDEX IF EXISTS public.dividends_unique_asset_exdate;
