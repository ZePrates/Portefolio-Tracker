ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS lot_breakdown jsonb;
CREATE INDEX IF NOT EXISTS transactions_asset_id_idx ON public.transactions (asset_id, traded_at, created_at);