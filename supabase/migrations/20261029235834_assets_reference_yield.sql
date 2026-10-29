alter table public.assets
  add column if not exists reference_yield numeric null,
  add column if not exists reference_yield_at timestamptz null;
comment on column public.assets.reference_yield is 'Yield de referência (%) de uma segunda fonte (Finnhub /stock/metric), para verificação cruzada do annual_yield calculado pela app.';
comment on column public.assets.reference_yield_at is 'Quando o reference_yield foi obtido.';
