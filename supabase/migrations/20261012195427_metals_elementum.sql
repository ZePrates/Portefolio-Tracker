-- Metais preciosos em custódia (ex.: Elementum).
-- assets: dados do cofre e desconto de recompra (valor = spot × (1 − desconto)).
-- transactions.premium_rate: ágio da compra; o preço guardado é o spot e o ágio
--   em EUR fica na comissão (fee), para o custo FIFO incluir o ágio.
-- asset_expenses.grams_deducted: taxas pagas em metal; reduzem a quantidade
--   detida sem gerar vendas (o custo total mantém-se nos gramas restantes).

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS custodian text
    CHECK (custodian IS NULL OR char_length(custodian) <= 100),
  ADD COLUMN IF NOT EXISTS vault_ref text
    CHECK (vault_ref IS NULL OR char_length(vault_ref) <= 100),
  ADD COLUMN IF NOT EXISTS plan_name text
    CHECK (plan_name IS NULL OR char_length(plan_name) <= 100),
  ADD COLUMN IF NOT EXISTS buyback_discount numeric
    CHECK (buyback_discount IS NULL OR (buyback_discount >= 0 AND buyback_discount < 1));

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS premium_rate numeric
    CHECK (premium_rate IS NULL OR (premium_rate >= 0 AND premium_rate < 1));

ALTER TABLE public.asset_expenses
  ADD COLUMN IF NOT EXISTS grams_deducted numeric NOT NULL DEFAULT 0
    CHECK (grams_deducted >= 0),
  ADD COLUMN IF NOT EXISTS price_per_gram numeric
    CHECK (price_per_gram IS NULL OR price_per_gram > 0);
