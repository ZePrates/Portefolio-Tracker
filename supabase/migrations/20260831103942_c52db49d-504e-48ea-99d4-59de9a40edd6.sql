ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS native_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS purchase_price_native numeric,
  ADD COLUMN IF NOT EXISTS current_price_native numeric,
  ADD COLUMN IF NOT EXISTS dividend_frequency text,
  ADD COLUMN IF NOT EXISTS last_dividend_import timestamptz;

ALTER TABLE public.dividends
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS per_share numeric;

CREATE UNIQUE INDEX IF NOT EXISTS dividends_unique_auto
  ON public.dividends (user_id, asset_id, paid_at)
  WHERE asset_id IS NOT NULL AND source = 'yahoo';