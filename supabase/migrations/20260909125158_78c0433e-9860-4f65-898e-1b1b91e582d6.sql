-- Idempotência dos dividendos: chave determinística por utilizador + fonte + evento
CREATE UNIQUE INDEX IF NOT EXISTS dividends_source_event_uniq
  ON public.dividends (user_id, source, source_event_id)
  WHERE source_event_id IS NOT NULL;

-- Evita duplicados automáticos pelo mesmo ativo/ex-date/fonte
CREATE UNIQUE INDEX IF NOT EXISTS dividends_asset_exdate_source_uniq
  ON public.dividends (user_id, asset_id, ex_date, source)
  WHERE asset_id IS NOT NULL AND ex_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS dividends_payment_date_idx ON public.dividends (user_id, payment_date);

DROP TRIGGER IF EXISTS update_dividends_updated_at ON public.dividends;
CREATE TRIGGER update_dividends_updated_at
  BEFORE UPDATE ON public.dividends
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();