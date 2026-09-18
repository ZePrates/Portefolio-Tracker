-- ISIN informado pelo utilizador ao criar o ativo — identificador estável
-- e fiável para a resolução na fonte oficial da gestora, em vez de
-- depender de o adivinhar por pesquisa (ticker/nome).
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS isin text;

COMMENT ON COLUMN public.assets.isin IS
  'ISIN informado pelo utilizador (opcional). Usado com prioridade na resolução do fornecedor oficial de composição de ETFs.';