ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS access_alias text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS businesses_alias_unique ON public.businesses(access_alias) WHERE access_alias IS NOT NULL;
CREATE OR REPLACE FUNCTION app_internal.business_alias_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
BEGIN
 PERFORM pg_advisory_xact_lock(734390011);
 IF NEW.access_alias IS NOT NULL AND (NEW.access_alias !~ '^[a-z0-9][a-z0-9-]{2,59}$' OR EXISTS(SELECT 1 FROM public.businesses WHERE id<>NEW.id AND code=NEW.access_alias)) THEN RAISE EXCEPTION 'identifier_unavailable' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM public.businesses WHERE id<>NEW.id AND access_alias=NEW.code) THEN RAISE EXCEPTION 'identifier_unavailable' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION app_internal.business_alias_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_internal.business_alias_guard() TO service_role;
DROP TRIGGER IF EXISTS business_alias_guard ON public.businesses;
CREATE TRIGGER business_alias_guard BEFORE INSERT OR UPDATE OF access_alias,code ON public.businesses FOR EACH ROW EXECUTE FUNCTION app_internal.business_alias_guard();
CREATE OR REPLACE FUNCTION public.resolve_business_access(p_identifier text) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $f$
 SELECT code FROM public.businesses WHERE active AND deleted_at IS NULL AND (code=p_identifier OR access_alias=p_identifier) LIMIT 1;
$f$;
CREATE OR REPLACE FUNCTION public.update_business_access(p_business uuid,p_name text,p_alias text,p_active boolean DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE s text:='erp_'||replace(p_business::text,'-',''); r public.businesses;
BEGIN
 PERFORM pg_advisory_xact_lock(734390011);PERFORM pg_advisory_xact_lock(hashtextextended(s,0));
 UPDATE public.businesses SET name=p_name,access_alias=nullif(p_alias,''),active=coalesce(p_active,active) WHERE id=p_business AND deleted_at IS NULL RETURNING * INTO r;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF to_regclass(format('%I.settings',s)) IS NOT NULL THEN EXECUTE format('UPDATE %I.settings SET name=$1 WHERE id=1',s) USING p_name; END IF;
 IF NOT r.active THEN UPDATE public.support_sessions SET closed_at=now(),write_enabled=false WHERE business_id=p_business AND closed_at IS NULL; END IF;
 RETURN jsonb_build_object('id',r.id,'code',r.code,'name',r.name,'access_alias',r.access_alias,'active',r.active);
END $f$;
CREATE TABLE IF NOT EXISTS public.business_deletions(id uuid PRIMARY KEY REFERENCES public.businesses(id),business_name text NOT NULL,actor_id uuid NOT NULL REFERENCES public.platform_admins(user_id),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.business_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_deletions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.business_deletions TO service_role;
CREATE POLICY backend_only ON public.business_deletions FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE OR REPLACE FUNCTION public.business_delete_preview(p_business uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE b public.businesses;s text:='erp_'||replace(p_business::text,'-','');n bigint:=0;c bigint;tbl text;products bigint:=0;images bigint:=0;
BEGIN
 SELECT * INTO b FROM public.businesses WHERE id=p_business;IF NOT FOUND THEN RETURN NULL;END IF;
 IF to_regclass(format('%I.orders',s)) IS NOT NULL THEN
  FOREACH tbl IN ARRAY ARRAY['orders','ledger','purchases','accounts','inventory_moves'] LOOP EXECUTE format('SELECT count(*) FROM %I.%I',s,tbl) INTO c;n:=n+c;END LOOP;
  EXECUTE format('SELECT count(*) FROM %I.products',s) INTO products;EXECUTE format('SELECT count(*) FROM %I.media',s) INTO images;
 END IF;
 SELECT count(*) INTO c FROM public.support_tickets WHERE business_id=p_business;n:=n+c;
 RETURN jsonb_build_object('id',b.id,'name',b.name,'code',b.code,'access_alias',b.access_alias,'active',b.active,'movements',n,'products',products,'images',images,'users',(SELECT count(*) FROM public.business_members WHERE business_id=p_business),'deleted_at',b.deleted_at,'can_delete',n=0 AND b.deleted_at IS NULL);
END $f$;
CREATE OR REPLACE FUNCTION public.delete_empty_business(p_business uuid,p_actor uuid,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE s text:='erp_'||replace(p_business::text,'-','');b public.businesses;info jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=p_actor AND active) THEN RAISE EXCEPTION 'Platform only' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(s,0));SELECT * INTO b FROM public.businesses WHERE id=p_business FOR UPDATE;
 IF NOT FOUND OR b.name<>p_confirmation THEN RAISE EXCEPTION 'Confirmation mismatch';END IF;
 IF b.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('id',b.id,'deleted',true);END IF;
 info:=public.business_delete_preview(p_business);IF NOT (info->>'can_delete')::boolean THEN RAISE EXCEPTION 'business_has_history';END IF;
 IF EXISTS(SELECT 1 FROM public.business_members m JOIN public.platform_admins a ON a.user_id=m.user_id WHERE m.business_id=p_business) THEN RAISE EXCEPTION 'Protected platform user';END IF;
 INSERT INTO public.business_deletions(id,business_name,actor_id) VALUES(p_business,b.name,p_actor);
 INSERT INTO public.access_audit(actor_id,business_id,action,details) VALUES(p_actor,p_business,'business.removed.from.panel',jsonb_build_object('name',b.name,'code',b.code,'users',info->'users','products',info->'products'));
 UPDATE public.business_members SET active=false,version=version+1 WHERE business_id=p_business;
 UPDATE public.support_sessions SET closed_at=now(),write_enabled=false WHERE business_id=p_business AND closed_at IS NULL;
 UPDATE public.businesses SET active=false,deleted_at=now() WHERE id=p_business;
 RETURN jsonb_build_object('id',b.id,'deleted',true);
END $f$;
REVOKE ALL ON FUNCTION public.resolve_business_access(text),public.update_business_access(uuid,text,text,boolean),public.business_delete_preview(uuid),public.delete_empty_business(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_business_access(text),public.update_business_access(uuid,text,text,boolean),public.business_delete_preview(uuid),public.delete_empty_business(uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.support_overview() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT jsonb_build_object('server_time',now(),'businesses',coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.name),'[]'::jsonb)) FROM (
 SELECT b.id,b.code,b.name,b.access_alias,b.active,b.created_at,
 (SELECT max(p.last_seen_at) FROM public.business_presence p WHERE p.business_id=b.id) last_seen_at,
 (SELECT count(*) FROM public.business_presence p JOIN public.business_members m ON m.user_id=p.user_id AND m.business_id=p.business_id WHERE p.business_id=b.id AND p.last_seen_at>now()-interval '2 minutes' AND m.active) online_users,
 (SELECT count(*) FROM public.support_tickets t WHERE t.business_id=b.id AND t.status!='resolved') open_tickets,
 (SELECT count(*) FROM public.support_tickets t WHERE t.business_id=b.id AND (t.support_seen_at IS NULL OR t.last_customer_at>t.support_seen_at)) unread_tickets
 FROM public.businesses b WHERE b.deleted_at IS NULL) r;
$fn$;
