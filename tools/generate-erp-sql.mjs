import fs from 'node:fs';const commands=JSON.parse(fs.readFileSync('/workspace/lanchonete-login/backend/erp/tenant-ddl.json','utf8'));const list=commands.map(s=>"'"+s.replaceAll("'","''")+"'").join(',\n');
const sql=`-- Private tenant schemas are provisioned only by the verified backend.
ALTER TABLE public.business_profiles ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION app_internal.ensure_erp(p_business uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE s text:='erp_'||replace(p_business::text,'-',''); cmd text; shop text; tbl record;
BEGIN
 IF current_setting('role',true) NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'Backend only' USING ERRCODE='42501'; END IF;
 SELECT name INTO shop FROM public.businesses WHERE id=p_business AND active;
 IF shop IS NULL THEN RAISE EXCEPTION 'Estabelecimento indisponível'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(s,0));
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=s) THEN
 EXECUTE format('CREATE SCHEMA %I',s);
 FOREACH cmd IN ARRAY ARRAY[${list}] LOOP EXECUTE replace(cmd,'__SCHEMA__',quote_ident(s)); END LOOP;
 EXECUTE format('INSERT INTO %I.settings(id,name,updated_at) VALUES(1,$1,$2)',s) USING shop,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 FOR i IN 1..15 LOOP EXECUTE format('INSERT INTO %I.dining_tables(id,number,seats,created_at) VALUES($1,$2,NULL,$3)',s) USING gen_random_uuid()::text,i,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); END LOOP;
 FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname=s LOOP EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',s,tbl.tablename); END LOOP;
 EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC,anon,authenticated',s);
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO service_role',s);
 EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO service_role',s);
 EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO service_role',s);
 END IF;
 RETURN s;
END $fn$;
REVOKE ALL ON FUNCTION app_internal.ensure_erp(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_internal.ensure_erp(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.erp_run(p_business uuid,p_commands jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE s text; cmd jsonb; q text; result jsonb:='[]'; rows jsonb; affected bigint:=0; previous bigint:=0;
BEGIN
 IF current_setting('role',true) NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'Backend only' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_commands)!='array' OR jsonb_array_length(p_commands)>1000 THEN RAISE EXCEPTION 'Invalid batch'; END IF;
 s:=app_internal.ensure_erp(p_business);
 PERFORM set_config('search_path',quote_ident(s)||',pg_catalog',true);
 PERFORM set_config('statement_timeout','8000',true);
 FOR cmd IN SELECT value FROM jsonb_array_elements(p_commands) LOOP
 q:=replace(cmd->>'sql','__ERP_CHANGES__',previous::text);
 IF q !~* '^\\s*(SELECT|INSERT|UPDATE|DELETE)\\s' THEN RAISE EXCEPTION 'Unsupported statement'; END IF;
 IF q ~* '^\\s*SELECT\\s' THEN
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM ('||q||') r' INTO rows;affected:=0;
 ELSE
 IF coalesce((cmd->>'ignore')::boolean,false) AND q !~* 'ON CONFLICT' THEN q:=q||' ON CONFLICT DO NOTHING'; END IF;
 EXECUTE q;GET DIAGNOSTICS affected=ROW_COUNT;rows:='[]';
 END IF;
 result:=result||jsonb_build_array(jsonb_build_object('results',rows,'meta',jsonb_build_object('changes',affected),'success',true));previous:=affected;
 END LOOP;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.erp_run(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.erp_run(uuid,jsonb) TO service_role;
`;
fs.writeFileSync('/workspace/lanchonete-login/backend/erp-schema.sql',sql);
