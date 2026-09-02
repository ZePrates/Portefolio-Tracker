
ALTER TABLE public.dividends
  ADD COLUMN IF NOT EXISTS ex_date date,
  ADD COLUMN IF NOT EXISTS record_date date,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS per_share_native numeric,
  ADD COLUMN IF NOT EXISTS amount_native numeric,
  ADD COLUMN IF NOT EXISTS fx_rate numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fx_date date,
  ADD COLUMN IF NOT EXISTS gross_amount numeric,
  ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric,
  ADD COLUMN IF NOT EXISTS eligible_quantity numeric,
  ADD COLUMN IF NOT EXISTS source_event_id text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.dividends SET payment_date = paid_at WHERE payment_date IS NULL;
UPDATE public.dividends SET ex_date = paid_at WHERE ex_date IS NULL;
UPDATE public.dividends SET gross_amount = amount WHERE gross_amount IS NULL;
UPDATE public.dividends SET net_amount = amount WHERE net_amount IS NULL;

ALTER TABLE public.dividends
  DROP CONSTRAINT IF EXISTS dividends_status_check;
ALTER TABLE public.dividends
  ADD CONSTRAINT dividends_status_check CHECK (status IN ('received','scheduled','unknown'));

CREATE UNIQUE INDEX IF NOT EXISTS dividends_unique_source_event
  ON public.dividends (user_id, asset_id, source, source_event_id)
  WHERE source_event_id IS NOT NULL AND asset_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dividends_unique_asset_exdate
  ON public.dividends (user_id, asset_id, ex_date)
  WHERE asset_id IS NOT NULL AND ex_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS dividends_asset_idx ON public.dividends (asset_id);

DROP TRIGGER IF EXISTS update_dividends_updated_at ON public.dividends;
CREATE TRIGGER update_dividends_updated_at
  BEFORE UPDATE ON public.dividends
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS last_dividend_sync timestamptz;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dividends TO authenticated;
GRANT ALL ON public.dividends TO service_role;
