-- IRS: arquivo de relatórios fiscais oficiais (XTB, Scramble, ...) e opções por ano fiscal.
-- Já aplicada na base externa; este ficheiro serve só de registo. Só adições. Reverter:
--   DROP TABLE IF EXISTS public.tax_documents;
--   DROP TABLE IF EXISTS public.tax_year_settings;
--   DELETE FROM storage.buckets WHERE id = 'tax-documents'; (depois de esvaziar)

CREATE TABLE IF NOT EXISTS public.tax_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  tax_year integer NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
  source text NOT NULL CHECK (source IN ('xtb', 'scramble', 'elementum', 'other')),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  file_path text CHECK (file_path IS NULL OR char_length(file_path) <= 500),
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 255),
  mime_type text CHECK (mime_type IS NULL OR char_length(mime_type) <= 100),
  file_size integer CHECK (file_size IS NULL OR file_size >= 0),
  realization_value numeric,
  acquisition_value numeric,
  expenses numeric,
  net_gains numeric,
  dividends_gross numeric,
  dividends_tax_withheld numeric,
  interest_gross numeric,
  interest_tax_withheld numeric,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.tax_documents IS
  'Relatórios fiscais oficiais por ano (XTB, Scramble...) com totais para reconciliar com o cálculo da app.';
CREATE INDEX IF NOT EXISTS tax_documents_user_year_idx ON public.tax_documents (user_id, tax_year);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_documents TO authenticated;
GRANT ALL ON public.tax_documents TO service_role;
ALTER TABLE public.tax_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own tax documents" ON public.tax_documents;
CREATE POLICY "Users manage their own tax documents" ON public.tax_documents FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP TRIGGER IF EXISTS update_tax_documents_updated_at ON public.tax_documents;
CREATE TRIGGER update_tax_documents_updated_at BEFORE UPDATE ON public.tax_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.tax_year_settings (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  tax_year integer NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
  opted_aggregation boolean NOT NULL DEFAULT false,
  taxable_income numeric CHECK (taxable_income IS NULL OR taxable_income >= 0),
  marginal_rate numeric CHECK (marginal_rate IS NULL OR (marginal_rate >= 0 AND marginal_rate < 1)),
  manual_loss_carryforward numeric NOT NULL DEFAULT 0 CHECK (manual_loss_carryforward >= 0),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tax_year)
);
COMMENT ON TABLE public.tax_year_settings IS
  'Opções fiscais por ano: englobamento (quadro 15 Anexo G / 9.2A Anexo J), rendimento coletável e menos-valias reportadas.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_year_settings TO authenticated;
GRANT ALL ON public.tax_year_settings TO service_role;
ALTER TABLE public.tax_year_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own tax year settings" ON public.tax_year_settings;
CREATE POLICY "Users manage their own tax year settings" ON public.tax_year_settings FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP TRIGGER IF EXISTS update_tax_year_settings_updated_at ON public.tax_year_settings;
CREATE TRIGGER update_tax_year_settings_updated_at BEFORE UPDATE ON public.tax_year_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tax-documents', 'tax-documents', false, 10485760,
  ARRAY['application/pdf', 'text/csv', 'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Tax docs: read own" ON storage.objects;
CREATE POLICY "Tax docs: read own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tax-documents' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS "Tax docs: insert own" ON storage.objects;
CREATE POLICY "Tax docs: insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tax-documents' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS "Tax docs: update own" ON storage.objects;
CREATE POLICY "Tax docs: update own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'tax-documents' AND (storage.foldername(name))[1] = (select auth.uid())::text)
  WITH CHECK (bucket_id = 'tax-documents' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS "Tax docs: delete own" ON storage.objects;
CREATE POLICY "Tax docs: delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tax-documents' AND (storage.foldername(name))[1] = (select auth.uid())::text);
