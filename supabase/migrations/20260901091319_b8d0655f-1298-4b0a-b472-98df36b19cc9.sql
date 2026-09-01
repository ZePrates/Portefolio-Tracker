ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_native numeric,
  ADD COLUMN IF NOT EXISTS native_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS price_native numeric,
  ADD COLUMN IF NOT EXISTS fx_rate numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS realized_pl numeric,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS update_transactions_updated_at ON public.transactions;
CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS transactions_asset_traded_idx ON public.transactions (asset_id, traded_at, created_at);

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS realized_pl numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_fees numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

INSERT INTO public.transactions (user_id, asset_id, type, quantity, price, total, traded_at, source, native_currency, price_native, fx_rate)
SELECT a.user_id,
       a.id,
       'buy',
       a.quantity,
       COALESCE(NULLIF(a.average_price, 0), CASE WHEN a.quantity > 0 THEN a.invested_amount / a.quantity ELSE 0 END),
       COALESCE(NULLIF(a.invested_amount, 0), a.quantity * a.average_price),
       a.created_at::date,
       'backfill',
       COALESCE(a.native_currency, 'EUR'),
       a.purchase_price_native,
       CASE WHEN a.purchase_price_native IS NOT NULL AND a.purchase_price_native > 0 AND a.average_price > 0
            THEN a.average_price / a.purchase_price_native ELSE 1 END
FROM public.assets a
WHERE a.quantity > 0
  AND NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.asset_id = a.id);

UPDATE public.assets SET status = 'closed', closed_at = COALESCE(closed_at, now()) WHERE quantity <= 0;