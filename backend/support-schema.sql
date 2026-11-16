-- All client access is through support-access after verified membership/platform authorization.
CREATE TABLE public.business_presence (
 business_id uuid NOT NULL REFERENCES public.businesses(id), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 display_name text NOT NULL, role text NOT NULL, route text NOT NULL DEFAULT '', last_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,user_id)
);
CREATE INDEX business_presence_recent ON public.business_presence(last_seen_at DESC);
CREATE TABLE public.support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 business_id uuid NOT NULL REFERENCES public.businesses(id), created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 requester_name text NOT NULL, request_key uuid NOT NULL, subject text NOT NULL CHECK(char_length(subject) BETWEEN 3 AND 120),
 category text NOT NULL CHECK(category IN ('error','question','suggestion','complaint')),
 priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','urgent')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','waiting_customer','resolved')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 last_customer_at timestamptz NOT NULL DEFAULT now(),last_support_at timestamptz,support_seen_at timestamptz,customer_seen_at timestamptz,
 UNIQUE(business_id,request_key)
);
CREATE INDEX support_tickets_business_updated ON public.support_tickets(business_id,updated_at DESC);
CREATE INDEX support_tickets_status_updated ON public.support_tickets(status,updated_at DESC);
CREATE INDEX support_tickets_creator_recent ON public.support_tickets(created_by,created_at DESC);
CREATE TABLE public.support_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES public.support_tickets(id),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, actor_name text NOT NULL, side text NOT NULL CHECK(side IN ('customer','platform')),
 request_key uuid NOT NULL, body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(ticket_id,request_key)
);
CREATE INDEX support_messages_ticket_time ON public.support_messages(ticket_id,created_at);
CREATE TABLE public.support_email_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES public.support_tickets(id),
 message_id uuid NOT NULL UNIQUE REFERENCES public.support_messages(id),status text NOT NULL DEFAULT 'awaiting_configuration' CHECK(status IN ('awaiting_configuration','pending','sending','sent','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,last_attempt_at timestamptz,attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX support_email_pending ON public.support_email_outbox(status,created_at);
ALTER TABLE public.business_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_presence,public.support_tickets,public.support_messages,public.support_email_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.business_presence,public.support_tickets,public.support_messages,public.support_email_outbox TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.support_tickets_number_seq TO service_role;
CREATE POLICY backend_only ON public.business_presence FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY backend_only ON public.support_tickets FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY backend_only ON public.support_messages FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY backend_only ON public.support_email_outbox FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.support_heartbeat(p_business uuid,p_actor uuid,p_name text,p_role text,p_route text) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 INSERT INTO public.business_presence(business_id,user_id,display_name,role,route,last_seen_at)
 SELECT p_business,p_actor,left(p_name,100),left(p_role,20),left(p_route,50),clock_timestamp()
 WHERE EXISTS(SELECT 1 FROM public.business_members m JOIN public.businesses b ON b.id=m.business_id WHERE m.user_id=p_actor AND m.business_id=p_business AND m.active AND b.active)
 ON CONFLICT(business_id,user_id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,route=excluded.route,last_seen_at=excluded.last_seen_at
 WHERE public.business_presence.last_seen_at < clock_timestamp()-interval '25 seconds'
 RETURNING true;
$fn$;
CREATE FUNCTION public.support_overview() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT jsonb_build_object('server_time',now(),'businesses',coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.name),'[]'::jsonb)) FROM (
 SELECT b.id,b.code,b.name,b.active,b.created_at,
 (SELECT max(p.last_seen_at) FROM public.business_presence p WHERE p.business_id=b.id) last_seen_at,
 (SELECT count(*) FROM public.business_presence p JOIN public.business_members m ON m.user_id=p.user_id AND m.business_id=p.business_id WHERE p.business_id=b.id AND p.last_seen_at>now()-interval '2 minutes' AND m.active) online_users,
 (SELECT count(*) FROM public.support_tickets t WHERE t.business_id=b.id AND t.status!='resolved') open_tickets,
 (SELECT count(*) FROM public.support_tickets t WHERE t.business_id=b.id AND (t.support_seen_at IS NULL OR t.last_customer_at>t.support_seen_at)) unread_tickets
 FROM public.businesses b) r;
$fn$;
CREATE FUNCTION public.support_create_ticket(p_business uuid,p_actor uuid,p_name text,p_request uuid,p_subject text,p_category text,p_priority text,p_message text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE t public.support_tickets; message_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_business::text||p_actor::text,21));
 SELECT * INTO t FROM public.support_tickets WHERE business_id=p_business AND request_key=p_request;
 IF FOUND THEN IF t.created_by IS DISTINCT FROM p_actor THEN RETURN jsonb_build_object('conflict',true); END IF; RETURN to_jsonb(t); END IF;
 IF (SELECT count(*) FROM public.support_tickets WHERE business_id=p_business AND created_by=p_actor AND created_at>now()-interval '1 hour')>=6 THEN RETURN jsonb_build_object('rate_limited',true); END IF;
 INSERT INTO public.support_tickets(business_id,created_by,requester_name,request_key,subject,category,priority,customer_seen_at)
 VALUES(p_business,p_actor,p_name,p_request,p_subject,p_category,p_priority,clock_timestamp()) RETURNING * INTO t;
 INSERT INTO public.support_messages(ticket_id,actor_id,actor_name,side,request_key,body) VALUES(t.id,p_actor,p_name,'customer',p_request,p_message) RETURNING id INTO message_id;
 INSERT INTO public.support_email_outbox(ticket_id,message_id) VALUES(t.id,message_id);
 RETURN to_jsonb(t);
END $fn$;
CREATE FUNCTION public.support_reply(p_ticket uuid,p_actor uuid,p_name text,p_side text,p_request uuid,p_message text,p_status text DEFAULT NULL,p_version integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE t public.support_tickets; message_id uuid; ts timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO t FROM public.support_tickets WHERE id=p_ticket FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('missing',true); END IF;
 IF EXISTS(SELECT 1 FROM public.support_messages WHERE ticket_id=p_ticket AND request_key=p_request AND actor_id=p_actor) THEN RETURN to_jsonb(t); END IF;
 IF p_version IS NOT NULL AND t.version!=p_version THEN RETURN jsonb_build_object('conflict',true); END IF;
 IF p_status IS NOT NULL AND (p_side!='platform' OR p_status NOT IN ('open','in_progress','waiting_customer','resolved')) THEN RAISE EXCEPTION 'Invalid status'; END IF;
 IF p_message IS NOT NULL AND length(p_message)>0 THEN
 INSERT INTO public.support_messages(ticket_id,actor_id,actor_name,side,request_key,body) VALUES(t.id,p_actor,p_name,p_side,p_request,p_message) RETURNING id INTO message_id;
 IF p_side='customer' THEN INSERT INTO public.support_email_outbox(ticket_id,message_id) VALUES(t.id,message_id); END IF;
 END IF;
 UPDATE public.support_tickets SET updated_at=ts,version=version+1,
 status=coalesce(p_status,CASE WHEN p_side='customer' AND status='resolved' THEN 'open' ELSE status END),
 last_customer_at=CASE WHEN p_side='customer' AND message_id IS NOT NULL THEN ts ELSE last_customer_at END,
 last_support_at=CASE WHEN p_side='platform' AND message_id IS NOT NULL THEN ts ELSE last_support_at END,
 support_seen_at=CASE WHEN p_side='platform' THEN ts ELSE support_seen_at END,
 customer_seen_at=CASE WHEN p_side='customer' THEN ts ELSE customer_seen_at END WHERE id=t.id RETURNING * INTO t;
 RETURN to_jsonb(t);
END $fn$;
REVOKE ALL ON FUNCTION public.support_heartbeat(uuid,uuid,text,text,text),public.support_overview(),public.support_create_ticket(uuid,uuid,text,uuid,text,text,text,text),public.support_reply(uuid,uuid,text,text,uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_heartbeat(uuid,uuid,text,text,text),public.support_overview(),public.support_create_ticket(uuid,uuid,text,uuid,text,text,text,text),public.support_reply(uuid,uuid,text,text,uuid,text,text,integer) TO service_role;
