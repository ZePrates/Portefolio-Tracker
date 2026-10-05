-- Valor de mercado pode não existir num ponto do histórico (ex.: meses em que só
-- se registou o capital investido). NULL = "sem valor de mercado registado",
-- nunca "zero" nem "igual ao investido".
ALTER TABLE public.portfolio_snapshots ALTER COLUMN market_value DROP NOT NULL;
ALTER TABLE public.portfolio_snapshots ALTER COLUMN market_value DROP DEFAULT;
