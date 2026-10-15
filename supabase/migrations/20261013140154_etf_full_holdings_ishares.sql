-- Holdings completas a partir das gestoras (Fase 1: iShares)

alter table public.etf_holdings
  add column if not exists asset_class text,
  add column if not exists exchange text,
  add column if not exists market_value numeric;

create index if not exists etf_holdings_asset_id_idx on public.etf_holdings(asset_id);
create index if not exists etf_holdings_symbol_idx on public.etf_holdings(holding_symbol);

alter table public.asset_profiles
  add column if not exists holdings_status text check (holdings_status is null or holdings_status in ('full','partial','error')),
  add column if not exists holdings_coverage numeric,
  add column if not exists holdings_synced_at timestamptz,
  add column if not exists holdings_error text;

comment on column public.asset_profiles.holdings_status is 'full = lista completa da gestora; partial = só top N (ex.: justETF); error = última sincronização falhou (mantém-se a lista anterior).';
comment on column public.asset_profiles.holdings_coverage is 'Soma dos pesos das holdings guardadas (0..1).';

-- Mapeia setores GICS da iShares para os nomes já usados na app
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
    when 'Materials' then 'Non-Energy Materials'
    when 'Cash and/or Derivatives' then 'Cash e derivados'
    when '' then null
    else p end
$$;

-- Importa o CSV oficial da iShares para um ativo do utilizador autenticado.
-- Atómico: se a validação falhar, nada muda e fica registado o erro.
create or replace function public.import_ishares_holdings(p_asset_id uuid, p_csv text, p_portfolio_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_lines text[];
  v_header text[];
  v_as_of date;
  v_hidx int;
  i int;
  v_fields text[];
  v_rows jsonb := '[]'::jsonb;
  v_sum numeric := 0;
  v_n int := 0;
  c_ticker int; c_name int; c_sector int; c_class int; c_mv int; c_weight int; c_loc int; c_exch int; c_cur int; c_isin int;
  v_w numeric;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if not exists (select 1 from public.assets a where a.id = p_asset_id and a.user_id = v_uid) then
    raise exception 'Ativo não encontrado';
  end if;

  v_lines := string_to_array(replace(p_csv, E'\r', ''), E'\n');

  -- data de referência
  v_as_of := to_date(substring(p_csv from 'Fund Holdings as of,"?([0-9]{2}/[A-Za-z]{3}/[0-9]{4})'), 'DD/Mon/YYYY');

  -- linha de cabeçalho
  for i in 1 .. coalesce(array_length(v_lines,1),0) loop
    if v_lines[i] ~* '^"?Ticker"?,' then v_hidx := i; exit; end if;
  end loop;
  if v_hidx is null then raise exception 'CSV sem cabeçalho de holdings reconhecido'; end if;

  select array_agg(btrim(x, ' "') order by o) into v_header
  from unnest(string_to_array(v_lines[v_hidx], ',')) with ordinality as t(x, o);

  c_ticker := array_position(v_header, 'Ticker');
  c_name   := array_position(v_header, 'Name');
  c_sector := array_position(v_header, 'Sector');
  c_class  := array_position(v_header, 'Asset Class');
  c_mv     := array_position(v_header, 'Market Value');
  c_weight := array_position(v_header, 'Weight (%)');
  c_loc    := array_position(v_header, 'Location');
  c_exch   := array_position(v_header, 'Exchange');
  c_cur    := array_position(v_header, 'Market Currency');
  c_isin   := array_position(v_header, 'ISIN');
  if c_name is null or c_weight is null then raise exception 'CSV sem colunas Name/Weight'; end if;

  for i in v_hidx + 1 .. array_length(v_lines,1) loop
    continue when v_lines[i] is null or v_lines[i] !~ '^"';
    select array_agg(m[1] order by o) into v_fields
    from regexp_matches(v_lines[i], '"([^"]*)"', 'g') with ordinality as t(m, o);
    continue when v_fields is null or array_length(v_fields,1) < array_length(v_header,1);
    v_w := nullif(replace(v_fields[c_weight], ',', ''), '-')::numeric / 100;
    continue when v_w is null or v_w <= 0;
    v_sum := v_sum + v_w;
    v_n := v_n + 1;
    v_rows := v_rows || jsonb_build_object(
      'symbol', nullif(nullif(v_fields[c_ticker], ''), '-'),
      'name', v_fields[c_name],
      'sector', public.map_gics_sector(v_fields[c_sector]),
      'asset_class', v_fields[c_class],
      'mv', nullif(replace(v_fields[c_mv], ',', ''), '-'),
      'weight', least(v_w, 1),
      'country', nullif(nullif(v_fields[c_loc], ''), '-'),
      'exchange', nullif(v_fields[c_exch], ''),
      'currency', nullif(v_fields[c_cur], ''),
      'isin', case when c_isin is not null then nullif(v_fields[c_isin], '') end);
  end loop;

  if v_n = 0 or v_sum < 0.95 or v_sum > 1.05 then
    update public.asset_profiles set holdings_status = 'error', holdings_synced_at = now(),
      holdings_error = format('Validação falhou: %s linhas, soma dos pesos %s %%', v_n, round(v_sum*100, 2))
    where asset_id = p_asset_id;
    return jsonb_build_object('ok', false, 'rows', v_n, 'weight_sum', v_sum);
  end if;

  delete from public.etf_holdings where asset_id = p_asset_id;
  insert into public.etf_holdings (user_id, asset_id, holding_name, holding_symbol, weight, country, sector, currency, as_of_date, source, isin, asset_class, exchange, market_value)
  select v_uid, p_asset_id, r->>'name', r->>'symbol', (r->>'weight')::numeric, r->>'country', r->>'sector', r->>'currency', v_as_of, 'ishares', r->>'isin', r->>'asset_class', r->>'exchange', (r->>'mv')::numeric
  from jsonb_array_elements(v_rows) r;

  -- recalcular exposições país/setor deste ETF a partir da lista completa
  delete from public.asset_exposures where asset_id = p_asset_id and dimension in ('country','sector');
  insert into public.asset_exposures (user_id, asset_id, dimension, value, weight, source, as_of_date)
  select v_uid, p_asset_id, 'country', coalesce(country, 'Other'), least(sum(weight) / v_sum, 1), 'ishares', v_as_of
  from public.etf_holdings where asset_id = p_asset_id group by 4
  union all
  select v_uid, p_asset_id, 'sector', coalesce(sector, 'Other'), least(sum(weight) / v_sum, 1), 'ishares', v_as_of
  from public.etf_holdings where asset_id = p_asset_id group by 4;

  insert into public.asset_profiles (user_id, asset_id) values (v_uid, p_asset_id)
  on conflict (asset_id) do nothing;
  update public.asset_profiles set
    manager_slug = 'ishares',
    provider_ref = coalesce(provider_ref, '{}'::jsonb) || case when p_portfolio_id is null then '{}'::jsonb else jsonb_build_object('ishares_portfolio_id', p_portfolio_id) end,
    holdings_count = v_n, holdings_coverage = least(v_sum, 1), holdings_status = 'full',
    holdings_synced_at = now(), holdings_error = null, as_of_date = v_as_of
  where asset_id = p_asset_id;

  return jsonb_build_object('ok', true, 'rows', v_n, 'weight_sum', v_sum, 'as_of', v_as_of);
end;
$$;

revoke all on function public.import_ishares_holdings(uuid, text, text) from public, anon;
grant execute on function public.import_ishares_holdings(uuid, text, text) to authenticated;

-- Marca as listas atuais (top 10 de terceiros) como parciais
update public.asset_profiles p set holdings_status = 'partial',
  holdings_coverage = (select least(sum(h.weight),1) from public.etf_holdings h where h.asset_id = p.asset_id)
where exists (select 1 from public.etf_holdings h where h.asset_id = p.asset_id);
