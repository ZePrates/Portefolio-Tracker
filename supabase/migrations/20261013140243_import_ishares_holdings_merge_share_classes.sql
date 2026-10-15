do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.import_ishares_holdings(uuid,text,text)'::regprocedure);
  v_def := replace(v_def,
$a$  select v_uid, p_asset_id, r->>'name', r->>'symbol', (r->>'weight')::numeric, r->>'country', r->>'sector', r->>'currency', v_as_of, 'ishares', r->>'isin', r->>'asset_class', r->>'exchange', (r->>'mv')::numeric
  from jsonb_array_elements(v_rows) r;$a$,
$b$  select v_uid, p_asset_id, r->>'name', min(r->>'symbol'), least(sum((r->>'weight')::numeric), 1), min(r->>'country'), min(r->>'sector'), min(r->>'currency'), v_as_of, 'ishares', min(r->>'isin'), min(r->>'asset_class'), min(r->>'exchange'), sum((r->>'mv')::numeric)
  from jsonb_array_elements(v_rows) r
  group by r->>'name';$b$);
  if v_def not like '%group by r->>''name''%' then raise exception 'substituição falhou'; end if;
  execute v_def;
end $do$;
