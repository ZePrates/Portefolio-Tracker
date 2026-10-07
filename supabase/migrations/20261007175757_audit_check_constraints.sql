-- Auditoria F14: regras de integridade que até agora só existiam no código.
-- Todos os dados atuais cumprem estas regras (verificado em 07/10/2026).
-- Padrão NOT VALID + VALIDATE: a validação não bloqueia escritas concorrentes.
--
-- Reverter:
--   ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_amounts_check;
--   ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_status_check;
--   ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_amounts_check;
--   ALTER TABLE public.dividends DROP CONSTRAINT IF EXISTS dividends_amounts_check;
--   ALTER TABLE public.asset_expenses DROP CONSTRAINT IF EXISTS asset_expenses_amounts_check;
--   ALTER TABLE public.portfolio_snapshots DROP CONSTRAINT IF EXISTS portfolio_snapshots_amounts_check;
--   ALTER TABLE public.asset_exposures DROP CONSTRAINT IF EXISTS asset_exposures_weight_check;
--   ALTER TABLE public.etf_holdings DROP CONSTRAINT IF EXISTS etf_holdings_weight_check;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_amounts_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_amounts_check
  CHECK (quantity > 0 AND price >= 0 AND fee >= 0 AND fx_rate > 0) NOT VALID;
ALTER TABLE public.transactions VALIDATE CONSTRAINT transactions_amounts_check;

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_status_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_status_check
  CHECK (status IN ('open', 'closed')) NOT VALID;
ALTER TABLE public.assets VALIDATE CONSTRAINT assets_status_check;

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_amounts_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_amounts_check
  CHECK (
    quantity >= 0 AND average_price >= 0 AND current_price >= 0
    AND invested_amount >= 0 AND current_value >= 0 AND total_fees >= 0
  ) NOT VALID;
ALTER TABLE public.assets VALIDATE CONSTRAINT assets_amounts_check;

ALTER TABLE public.dividends DROP CONSTRAINT IF EXISTS dividends_amounts_check;
ALTER TABLE public.dividends ADD CONSTRAINT dividends_amounts_check
  CHECK (
    amount >= 0 AND coalesce(gross_amount, 0) >= 0 AND tax_amount >= 0
    AND fee_amount >= 0 AND fx_rate > 0 AND coalesce(eligible_quantity, 0) >= 0
  ) NOT VALID;
ALTER TABLE public.dividends VALIDATE CONSTRAINT dividends_amounts_check;

ALTER TABLE public.asset_expenses DROP CONSTRAINT IF EXISTS asset_expenses_amounts_check;
ALTER TABLE public.asset_expenses ADD CONSTRAINT asset_expenses_amounts_check
  CHECK (amount >= 0 AND fx_rate > 0) NOT VALID;
ALTER TABLE public.asset_expenses VALIDATE CONSTRAINT asset_expenses_amounts_check;

ALTER TABLE public.portfolio_snapshots DROP CONSTRAINT IF EXISTS portfolio_snapshots_amounts_check;
ALTER TABLE public.portfolio_snapshots ADD CONSTRAINT portfolio_snapshots_amounts_check
  CHECK (invested_amount >= 0 AND coalesce(market_value, 0) >= 0) NOT VALID;
ALTER TABLE public.portfolio_snapshots VALIDATE CONSTRAINT portfolio_snapshots_amounts_check;

-- Pesos guardados como frações (0..1).
ALTER TABLE public.asset_exposures DROP CONSTRAINT IF EXISTS asset_exposures_weight_check;
ALTER TABLE public.asset_exposures ADD CONSTRAINT asset_exposures_weight_check
  CHECK (weight >= 0 AND weight <= 1.0001) NOT VALID;
ALTER TABLE public.asset_exposures VALIDATE CONSTRAINT asset_exposures_weight_check;

ALTER TABLE public.etf_holdings DROP CONSTRAINT IF EXISTS etf_holdings_weight_check;
ALTER TABLE public.etf_holdings ADD CONSTRAINT etf_holdings_weight_check
  CHECK (weight >= 0 AND weight <= 1.0001) NOT VALID;
ALTER TABLE public.etf_holdings VALIDATE CONSTRAINT etf_holdings_weight_check;
