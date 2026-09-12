-- Função usada por todos os triggers "update_<tabela>_updated_at" — usada
-- desde sempre mas nunca antes versionada (mais um caso de schema drift).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;
