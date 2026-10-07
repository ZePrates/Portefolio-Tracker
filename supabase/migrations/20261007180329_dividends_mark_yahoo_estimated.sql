-- Auditoria F6: o sync do Yahoo gravava a ex-date como data de pagamento.
-- Marca esses registos como "data de pagamento estimada" para que o
-- recálculo os possa corrigir e o import do broker os possa confirmar.
-- Não altera valores.
--
-- Reverter:
--   UPDATE public.dividends SET payment_date_estimated = false WHERE source = 'yahoo';
UPDATE public.dividends SET payment_date_estimated = true
WHERE source = 'yahoo' AND payment_date_estimated = false;
