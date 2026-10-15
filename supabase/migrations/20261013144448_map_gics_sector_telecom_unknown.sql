create or replace function public.map_gics_sector(p text)
returns text language sql immutable set search_path = '' as $$
  select case p
    when 'Information Technology' then 'Technology'
    when 'Financials' then 'Finance'
    when 'Health Care' then 'Healthcare'
    when 'Consumer Discretionary' then 'Consumer Cyclicals'
    when 'Consumer Staples' then 'Consumer Non-Cyclicals'
    when 'Communication' then 'Communication Services'
    when 'Communication Services' then 'Communication Services'
    when 'Telecommunications' then 'Communication Services'
    when 'Telecommunication Services' then 'Communication Services'
    when 'Materials' then 'Non-Energy Materials'
    when 'Cash and/or Derivatives' then 'Cash e derivados'
    when '' then null
    when '-' then null
    else case when lower(p) in ('unknown', 'n/a', 'other') then null else p end end
$$;
comment on function public.map_gics_sector(text) is 'Converte setores GICS das gestoras para os nomes usados na app.';
