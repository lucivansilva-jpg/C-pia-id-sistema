-- Definições reais consultadas no catálogo; revisão de dependências necessária.

CREATE OR REPLACE FUNCTION app_internal.business_alias_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 PERFORM pg_advisory_xact_lock(734390011);
 IF NEW.access_alias IS NOT NULL AND (NEW.access_alias !~ '^[a-z0-9][a-z0-9-]{2,59}$' OR EXISTS(SELECT 1 FROM public.businesses WHERE id<>NEW.id AND code=NEW.access_alias)) THEN RAISE EXCEPTION 'identifier_unavailable' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM public.businesses WHERE id<>NEW.id AND access_alias=NEW.code) THEN RAISE EXCEPTION 'identifier_unavailable' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION app_internal.commerce_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE kind text; pending boolean;
BEGIN
 IF TG_TABLE_NAME='orders' THEN
  IF NEW.state='open' THEN
   EXECUTE format('SELECT business_kind FROM %I.settings WHERE id=1',TG_TABLE_SCHEMA) INTO kind;
   IF kind='retail' THEN RAISE EXCEPTION 'retail_open_order_disabled' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='settings' THEN
  IF NEW.business_kind='retail' AND OLD.business_kind IS DISTINCT FROM NEW.business_kind THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.orders WHERE state=''open'' OR (state!=''cancelled'' AND fulfillment!=''delivered''))',TG_TABLE_SCHEMA) INTO pending;
   IF pending THEN RAISE EXCEPTION 'pending_food_orders' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='inventory_moves' THEN
  IF NEW.quantity_milli % 1000<>0 THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.products WHERE finished_inventory_id=$1 AND stock_mode=''unit'')',TG_TABLE_SCHEMA) INTO pending USING NEW.item_id;
   IF pending THEN RAISE EXCEPTION 'stock_integer_units' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION app_internal.ensure_commerce(p_business uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s text; v integer;
BEGIN
 IF current_setting('role',true) NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'Backend only' USING ERRCODE='42501'; END IF;
 s:=app_internal.ensure_erp(p_business);
 PERFORM pg_advisory_xact_lock(hashtextextended(s,0));
 IF to_regclass(format('%I.commerce_version',s)) IS NOT NULL THEN RETURN s; END IF;
 EXECUTE format('ALTER TABLE %I.settings ADD COLUMN IF NOT EXISTS business_kind text NOT NULL DEFAULT ''food'' CHECK(business_kind IN (''food'',''retail''))',s);
 EXECUTE format('ALTER TABLE %I.products ADD COLUMN IF NOT EXISTS barcode text, ADD COLUMN IF NOT EXISTS sale_unit text NOT NULL DEFAULT ''un'', ADD COLUMN IF NOT EXISTS packaging text NOT NULL DEFAULT '''', ADD COLUMN IF NOT EXISTS stock_mode text NOT NULL DEFAULT ''none'' CHECK(stock_mode IN (''none'',''unit'',''recipe'')), ADD COLUMN IF NOT EXISTS finished_inventory_id text REFERENCES %I.inventory_items(id)',s,s);
 EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique ON %I.products(barcode) WHERE barcode IS NOT NULL',s);
 EXECUTE format('UPDATE %I.products SET stock_mode=''recipe'' WHERE track_stock=1 AND stock_mode=''none''',s);
 EXECUTE format('CREATE TABLE %I.customers(id text PRIMARY KEY,name text NOT NULL,phone text NOT NULL DEFAULT '''',email text NOT NULL DEFAULT '''',document text NOT NULL DEFAULT '''',notes text NOT NULL DEFAULT '''',active bigint NOT NULL DEFAULT 1,version bigint NOT NULL DEFAULT 1,created_at text NOT NULL,updated_at text NOT NULL)',s);
 EXECUTE format('CREATE INDEX customers_name_idx ON %I.customers(name)',s);
 EXECUTE format('CREATE UNIQUE INDEX customers_document_unique ON %I.customers(document) WHERE document<>'''' AND active=1',s);
 EXECUTE format('ALTER TABLE %I.customers ENABLE ROW LEVEL SECURITY',s);
 EXECUTE format('CREATE POLICY backend_only ON %I.customers FOR ALL TO service_role USING(true) WITH CHECK(true)',s);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I.customers TO service_role',s);
 EXECUTE format('ALTER TABLE %I.orders ADD COLUMN IF NOT EXISTS customer_id text REFERENCES %I.customers(id),ADD COLUMN IF NOT EXISTS customer_name text NOT NULL DEFAULT ''''',s,s);
 EXECUTE format('CREATE INDEX orders_customer_idx ON %I.orders(customer_id)',s);
 EXECUTE format('CREATE TRIGGER commerce_orders_guard BEFORE INSERT ON %I.orders FOR EACH ROW EXECUTE FUNCTION app_internal.commerce_guard()',s);
 EXECUTE format('CREATE TRIGGER commerce_settings_guard BEFORE UPDATE OF business_kind ON %I.settings FOR EACH ROW EXECUTE FUNCTION app_internal.commerce_guard()',s);
 EXECUTE format('CREATE TRIGGER commerce_stock_guard BEFORE INSERT ON %I.inventory_moves FOR EACH ROW EXECUTE FUNCTION app_internal.commerce_guard()',s);
 EXECUTE format('CREATE TABLE %I.commerce_version(version integer PRIMARY KEY)',s);
 EXECUTE format('INSERT INTO %I.commerce_version VALUES(1)',s);
 EXECUTE format('ALTER TABLE %I.commerce_version ENABLE ROW LEVEL SECURITY',s);
 EXECUTE format('CREATE POLICY backend_only ON %I.commerce_version FOR SELECT TO service_role USING(true)',s);
 EXECUTE format('GRANT SELECT ON %I.commerce_version TO service_role',s);
 RETURN s;
END $function$
;

CREATE OR REPLACE FUNCTION app_internal.ensure_commerce_v2(p_business uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s text;done boolean;
BEGIN
 IF current_setting('role',true) NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'Backend only' USING ERRCODE='42501';END IF;
 s:=app_internal.ensure_commerce(p_business);PERFORM pg_advisory_xact_lock(hashtextextended(s,0));
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.commerce_version WHERE version=2)',s) INTO done;IF done THEN RETURN s;END IF;
 EXECUTE format('CREATE TABLE %I.product_import_rows(request_key text PRIMARY KEY,fingerprint text NOT NULL,actor_id text NOT NULL,product_id text NOT NULL REFERENCES %I.products(id),created_at text NOT NULL)',s,s);
 EXECUTE format('CREATE TABLE %I.sale_returns(id text PRIMARY KEY,request_key text NOT NULL UNIQUE,fingerprint text NOT NULL,order_id text NOT NULL REFERENCES %I.orders(id),kind text NOT NULL CHECK(kind IN (''return'',''exchange'')),items text NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>=0),restored_cost_cents bigint NOT NULL DEFAULT 0,unknown_cost_quantity bigint NOT NULL DEFAULT 0,original_closed_at text NOT NULL,replacement_order_id text REFERENCES %I.orders(id),actor_id text NOT NULL,reason text NOT NULL,created_at text NOT NULL)',s,s,s);
 EXECUTE format('CREATE TABLE %I.sale_return_lines(return_id text NOT NULL REFERENCES %I.sale_returns(id),item_id text NOT NULL,product_id text NOT NULL REFERENCES %I.products(id),quantity bigint NOT NULL CHECK(quantity>0),refund_cents bigint NOT NULL CHECK(refund_cents>=0),restocked bigint NOT NULL CHECK(restocked IN (0,1)),unit_cost_cents bigint,inventory_id text REFERENCES %I.inventory_items(id),PRIMARY KEY(return_id,item_id))',s,s,s,s);
 EXECUTE format('CREATE INDEX return_lines_item ON %I.sale_return_lines(item_id)',s);
 EXECUTE format('CREATE INDEX returns_order ON %I.sale_returns(order_id)',s);
 EXECUTE format('CREATE INDEX returns_created ON %I.sale_returns(created_at)',s);
 EXECUTE format('ALTER TABLE %I.orders ADD COLUMN exchange_from_order_id text REFERENCES %I.orders(id)',s,s);
 EXECUTE format('ALTER TABLE %I.ledger ADD CONSTRAINT refund_amount_negative CHECK(kind!=''refund'' OR amount_cents<0)',s);
 EXECUTE format('ALTER TABLE %I.product_import_rows ENABLE ROW LEVEL SECURITY',s);EXECUTE format('ALTER TABLE %I.sale_returns ENABLE ROW LEVEL SECURITY',s);EXECUTE format('ALTER TABLE %I.sale_return_lines ENABLE ROW LEVEL SECURITY',s);
 EXECUTE format('CREATE POLICY backend_only ON %I.product_import_rows FOR ALL TO service_role USING(true) WITH CHECK(true)',s);EXECUTE format('CREATE POLICY backend_only ON %I.sale_returns FOR ALL TO service_role USING(true) WITH CHECK(true)',s);EXECUTE format('CREATE POLICY backend_only ON %I.sale_return_lines FOR ALL TO service_role USING(true) WITH CHECK(true)',s);
 EXECUTE format('GRANT SELECT,INSERT ON %I.product_import_rows,%I.sale_return_lines TO service_role',s,s);EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I.sale_returns TO service_role',s);
 EXECUTE format('INSERT INTO %I.commerce_version VALUES(2)',s);RETURN s;
END $function$
;

CREATE OR REPLACE FUNCTION app_internal.ensure_erp(p_business uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s text:='erp_'||replace(p_business::text,'-',''); cmd text; shop text; tbl record;
BEGIN
 IF current_setting('role',true) NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'Backend only' USING ERRCODE='42501'; END IF;
 SELECT name INTO shop FROM public.businesses WHERE id=p_business AND active;
 IF shop IS NULL THEN RAISE EXCEPTION 'Estabelecimento indisponível'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(s,0));
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=s) THEN
 EXECUTE format('CREATE SCHEMA %I',s);
 FOREACH cmd IN ARRAY ARRAY['CREATE TABLE __SCHEMA__."accounts"("id" text NOT NULL,"request_key" text NOT NULL,"kind" text NOT NULL,"title" text NOT NULL,"amount_cents" bigint NOT NULL,"due_date" text NOT NULL,"state" text NOT NULL DEFAULT ''pending'',"actor_id" text NOT NULL,"created_at" text NOT NULL,"settled_at" text,"category" text NOT NULL DEFAULT ''Não classificado'',"recurrence" text,"recurrence_parent_id" text,"source_payment_id" text,PRIMARY KEY("id"))',
'CREATE UNIQUE INDEX "accounts_source_payment_id_unique" ON __SCHEMA__."accounts"("source_payment_id")',
'CREATE UNIQUE INDEX "accounts_recurrence_parent_id_unique" ON __SCHEMA__."accounts"("recurrence_parent_id")',
'CREATE UNIQUE INDEX "accounts_request_key_unique" ON __SCHEMA__."accounts"("request_key")',
'CREATE TABLE __SCHEMA__."audit_log"("id" text NOT NULL,"actor_id" text NOT NULL,"action" text NOT NULL,"entity_id" text NOT NULL,"created_at" text NOT NULL,PRIMARY KEY("id"))',
'CREATE INDEX "audit_created" ON __SCHEMA__."audit_log"("created_at")',
'CREATE TABLE __SCHEMA__."cash_sessions"("id" text NOT NULL,"state" text NOT NULL DEFAULT ''open'',"opening_cents" bigint NOT NULL,"counted_cents" bigint,"expected_cents" bigint,"difference_cents" bigint,"actor_id" text NOT NULL,"opened_at" text NOT NULL,"closed_at" text,"counted_methods_json" text,"expected_methods_json" text,"difference_methods_json" text,PRIMARY KEY("id"),CONSTRAINT "cash_opening" CHECK("cash_sessions"."opening_cents">=0))',
'CREATE UNIQUE INDEX "cash_one_open" ON __SCHEMA__."cash_sessions"("state") WHERE  "cash_sessions"."state"=''open''',
'CREATE TABLE __SCHEMA__."dining_tables"("id" text NOT NULL,"number" bigint NOT NULL,"seats" bigint,"active" bigint NOT NULL DEFAULT 1,"created_at" text NOT NULL,PRIMARY KEY("id"),CONSTRAINT "table_number" CHECK("dining_tables"."number">0),CONSTRAINT "table_seats" CHECK("dining_tables"."seats" IS NULL OR "dining_tables"."seats">0))',
'CREATE UNIQUE INDEX "dining_tables_number_unique" ON __SCHEMA__."dining_tables"("number")',
'CREATE TABLE __SCHEMA__."employees"("id" text NOT NULL,"name" text NOT NULL,"username" text NOT NULL,"role" text NOT NULL,"permissions" text NOT NULL DEFAULT ''[]'',"active" bigint NOT NULL DEFAULT 1,"created_at" text NOT NULL,"updated_at" text NOT NULL,"version" bigint NOT NULL DEFAULT 1,PRIMARY KEY("id"),CONSTRAINT "employee_role" CHECK("employees"."role" IN (''waiter'',''cashier'',''admin'')))',
'CREATE UNIQUE INDEX "employees_username_unique" ON __SCHEMA__."employees"("username")',
'CREATE TABLE __SCHEMA__."favorites"("user_id" text NOT NULL,"product_id" text NOT NULL,PRIMARY KEY("user_id","product_id"))',
'CREATE TABLE __SCHEMA__."inventory_items"("id" text NOT NULL,"name" text NOT NULL,"unit" text NOT NULL,"minimum_milli" bigint NOT NULL DEFAULT 0,"unit_cost_micro" bigint,"active" bigint NOT NULL DEFAULT 1,"created_at" text NOT NULL,"updated_at" text NOT NULL,PRIMARY KEY("id"))',
'CREATE TABLE __SCHEMA__."inventory_moves"("id" text NOT NULL,"request_key" text NOT NULL,"item_id" text NOT NULL,"quantity_milli" bigint NOT NULL,"kind" text NOT NULL,"source_id" text,"reason" text NOT NULL,"actor_id" text NOT NULL,"created_at" text NOT NULL,PRIMARY KEY("id"),CONSTRAINT "stock_qty_nonzero" CHECK("inventory_moves"."quantity_milli"!=0))',
'CREATE INDEX "inventory_item_moves" ON __SCHEMA__."inventory_moves"("item_id")',
'CREATE UNIQUE INDEX "inventory_moves_request_key_unique" ON __SCHEMA__."inventory_moves"("request_key")',
'CREATE TABLE __SCHEMA__."ledger"("id" text NOT NULL,"request_key" text NOT NULL,"session_id" text,"order_id" text,"account_id" text,"kind" text NOT NULL,"method" text NOT NULL,"amount_cents" bigint NOT NULL,"tendered_cents" bigint,"description" text NOT NULL,"actor_id" text NOT NULL,"created_at" text NOT NULL,"reversal_of" text,"authorized_by" text,"reason" text,"category" text NOT NULL DEFAULT ''Não classificado'',"finance_account" text NOT NULL DEFAULT ''bank'',"reconciled_at" text,"external_reference" text,"reconciled_by" text,PRIMARY KEY("id"))',
'CREATE INDEX "ledger_order" ON __SCHEMA__."ledger"("order_id")',
'CREATE INDEX "ledger_session" ON __SCHEMA__."ledger"("session_id")',
'CREATE UNIQUE INDEX "ledger_account_id_unique" ON __SCHEMA__."ledger"("account_id")',
'CREATE UNIQUE INDEX "ledger_request_key_unique" ON __SCHEMA__."ledger"("request_key")',
'CREATE TABLE __SCHEMA__."media"("key" text NOT NULL,"mime" text NOT NULL,"size" bigint NOT NULL,"created_by" text NOT NULL,"created_at" text NOT NULL,PRIMARY KEY("key"))',
'CREATE TABLE __SCHEMA__."orders"("number" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,"id" text NOT NULL,"request_key" text NOT NULL,"table_number" bigint,"state" text NOT NULL DEFAULT ''open'',"fulfillment" text NOT NULL DEFAULT ''pending'',"items" text NOT NULL,"total_cents" bigint NOT NULL,"version" bigint NOT NULL DEFAULT 1,"actor_id" text NOT NULL,"created_at" text NOT NULL,"updated_at" text NOT NULL,"discount_cents" bigint NOT NULL DEFAULT 0,"discount_reason" text NOT NULL DEFAULT '''',"authorized_by" text,"attendant_name" text NOT NULL DEFAULT '''',"closed_at" text,"checkout_waiting" bigint NOT NULL DEFAULT 0,"checkout_held_at" text,"checkout_held_by" text,PRIMARY KEY("number"))',
'CREATE UNIQUE INDEX "one_active_table" ON __SCHEMA__."orders"("table_number") WHERE  "orders"."table_number" IS NOT NULL AND ("orders"."state"=''open'' OR "orders"."fulfillment"!=''delivered'')',
'CREATE INDEX "orders_state" ON __SCHEMA__."orders"("state")',
'CREATE UNIQUE INDEX "orders_request_key_unique" ON __SCHEMA__."orders"("request_key")',
'CREATE UNIQUE INDEX "orders_id_unique" ON __SCHEMA__."orders"("id")',
'CREATE TABLE __SCHEMA__."products"("id" text NOT NULL,"name" text NOT NULL,"description" text NOT NULL DEFAULT '''',"category" text NOT NULL DEFAULT '''',"price_cents" bigint NOT NULL,"cost_cents" bigint,"image_key" text,"active" bigint NOT NULL DEFAULT 1,"available" bigint NOT NULL DEFAULT 1,"visible" bigint NOT NULL DEFAULT 1,"version" bigint NOT NULL DEFAULT 1,"created_at" text NOT NULL,"updated_at" text NOT NULL,"code" bigint,"options_json" text NOT NULL DEFAULT ''[]'',"addons_json" text NOT NULL DEFAULT ''[]'',"quick_notes_json" text NOT NULL DEFAULT ''[]'',"cost_mode" text NOT NULL DEFAULT ''direct'',"track_stock" bigint NOT NULL DEFAULT 0,PRIMARY KEY("id"),CONSTRAINT "price_nonnegative" CHECK("products"."price_cents">=0),CONSTRAINT "cost_nonnegative" CHECK("products"."cost_cents" IS NULL OR "products"."cost_cents">=0),CONSTRAINT "product_flags" CHECK("products"."active" IN (0,1) AND "products"."available" IN (0,1) AND "products"."visible" IN (0,1)))',
'CREATE UNIQUE INDEX "products_code_unique" ON __SCHEMA__."products"("code")',
'CREATE INDEX "products_active_name" ON __SCHEMA__."products"("active","name")',
'CREATE TABLE __SCHEMA__."purchases"("id" text NOT NULL,"request_key" text NOT NULL,"supplier_id" text,"items" text NOT NULL,"total_cents" bigint NOT NULL,"state" text NOT NULL DEFAULT ''draft'',"due_date" text NOT NULL,"created_at" text NOT NULL,"received_at" text,"actor_id" text NOT NULL,PRIMARY KEY("id"))',
'CREATE UNIQUE INDEX "purchases_request_key_unique" ON __SCHEMA__."purchases"("request_key")',
'CREATE TABLE __SCHEMA__."recipes"("product_id" text NOT NULL,"item_id" text NOT NULL,"quantity_milli" bigint NOT NULL,PRIMARY KEY("product_id","item_id"),CONSTRAINT "recipe_qty_positive" CHECK("recipes"."quantity_milli">0))',
'CREATE TABLE __SCHEMA__."role_profiles"("role" text NOT NULL,"name" text NOT NULL,"permissions" text NOT NULL DEFAULT ''{}'',"version" bigint NOT NULL DEFAULT 1,"updated_at" text NOT NULL,"updated_by" text NOT NULL,PRIMARY KEY("role"),CONSTRAINT "profile_role" CHECK("role_profiles"."role" IN (''admin'',''cashier'',''waiter'')))',
'CREATE TABLE __SCHEMA__."sale_drafts"("id" text NOT NULL,"request_key" text NOT NULL,"owner_id" text NOT NULL,"title" text NOT NULL,"items" text NOT NULL,"state" text NOT NULL DEFAULT ''waiting'',"converted_order_id" text,"version" bigint NOT NULL DEFAULT 1,"created_at" text NOT NULL,"updated_at" text NOT NULL,PRIMARY KEY("id"))',
'CREATE INDEX "drafts_owner_state" ON __SCHEMA__."sale_drafts"("owner_id","state")',
'CREATE UNIQUE INDEX "sale_drafts_request_key_unique" ON __SCHEMA__."sale_drafts"("request_key")',
'CREATE TABLE __SCHEMA__."settings"("id" bigint NOT NULL,"name" text NOT NULL DEFAULT ''Sua lanchonete'',"mode" text NOT NULL DEFAULT ''essential'',"paper" bigint NOT NULL DEFAULT 80,"updated_at" text NOT NULL,"cnpj" text NOT NULL DEFAULT '''',"address" text NOT NULL DEFAULT '''',"phone" text NOT NULL DEFAULT '''',"legal_name" text NOT NULL DEFAULT '''',"receipt_message" text NOT NULL DEFAULT ''Obrigado pela preferência! Volte sempre.'',"blind_close" bigint NOT NULL DEFAULT 0,"credit_fee_bps" bigint,"debit_fee_bps" bigint,"credit_days" bigint NOT NULL DEFAULT 30,"debit_days" bigint NOT NULL DEFAULT 1,"logo_key" text,"theme_color" text NOT NULL DEFAULT ''#6a330d'',PRIMARY KEY("id"),CONSTRAINT "settings_single" CHECK("settings"."id"=1))',
'CREATE TABLE __SCHEMA__."suppliers"("id" text NOT NULL,"name" text NOT NULL,"phone" text NOT NULL DEFAULT '''',"document" text NOT NULL DEFAULT '''',"notes" text NOT NULL DEFAULT '''',"active" bigint NOT NULL DEFAULT 1,"created_at" text NOT NULL,"updated_at" text NOT NULL,PRIMARY KEY("id"))',
'ALTER TABLE __SCHEMA__."favorites" ADD FOREIGN KEY("product_id") REFERENCES __SCHEMA__."products"("id")',
'ALTER TABLE __SCHEMA__."inventory_moves" ADD FOREIGN KEY("item_id") REFERENCES __SCHEMA__."inventory_items"("id")',
'ALTER TABLE __SCHEMA__."ledger" ADD FOREIGN KEY("account_id") REFERENCES __SCHEMA__."accounts"("id")',
'ALTER TABLE __SCHEMA__."ledger" ADD FOREIGN KEY("order_id") REFERENCES __SCHEMA__."orders"("id")',
'ALTER TABLE __SCHEMA__."ledger" ADD FOREIGN KEY("session_id") REFERENCES __SCHEMA__."cash_sessions"("id")',
'ALTER TABLE __SCHEMA__."purchases" ADD FOREIGN KEY("supplier_id") REFERENCES __SCHEMA__."suppliers"("id")',
'ALTER TABLE __SCHEMA__."recipes" ADD FOREIGN KEY("item_id") REFERENCES __SCHEMA__."inventory_items"("id")',
'ALTER TABLE __SCHEMA__."recipes" ADD FOREIGN KEY("product_id") REFERENCES __SCHEMA__."products"("id")',
'ALTER TABLE __SCHEMA__."sale_drafts" ADD FOREIGN KEY("converted_order_id") REFERENCES __SCHEMA__."orders"("id")'] LOOP EXECUTE replace(cmd,'__SCHEMA__',quote_ident(s)); END LOOP;
 EXECUTE format('INSERT INTO %I.settings(id,name,updated_at) VALUES(1,$1,$2)',s) USING shop,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 FOR i IN 1..15 LOOP EXECUTE format('INSERT INTO %I.dining_tables(id,number,seats,created_at) VALUES($1,$2,NULL,$3)',s) USING gen_random_uuid()::text,i,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); END LOOP;
 FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname=s LOOP EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',s,tbl.tablename); END LOOP;
 EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC,anon,authenticated',s);
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO service_role',s);
 EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO service_role',s);
 EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO service_role',s);
 END IF;
 RETURN s;
END $function$
;

CREATE OR REPLACE FUNCTION app_internal.require_managed_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare approved text;
begin
 delete from public.managed_registration_permits where email=lower(new.email) and expires_at>now() returning email into approved;
 if approved is null then
  raise exception using errcode='42501',message='User registration requires administrative provisioning';
 end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.bootstrap_business(p_owner uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare business uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select business_id into business from public.business_members where user_id=p_owner;
 if business is not null then return business; end if;
 insert into public.businesses(name,owner_user_id) values(p_name,p_owner) returning id into business;
 insert into public.business_profiles(business_id,role,name) values(business,'admin','Administrador / proprietário'),(business,'cashier','Caixa / responsável pela operação'),(business,'waiter','Garçom / atendimento');
 insert into public.business_members(user_id,business_id,display_name,role) values(p_owner,business,p_name,'admin');
 return business;
end $function$
;

CREATE OR REPLACE FUNCTION public.business_auth_session_valid(p_user uuid, p_session uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select exists(select 1 from auth.sessions where id=p_session and user_id=p_user) $function$
;

CREATE OR REPLACE FUNCTION public.business_delete_preview(p_business uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE b public.businesses;s text:='erp_'||replace(p_business::text,'-','');n bigint:=0;c bigint;tbl text;products bigint:=0;images bigint:=0;
BEGIN
 SELECT * INTO b FROM public.businesses WHERE id=p_business;IF NOT FOUND THEN RETURN NULL;END IF;
 IF to_regclass(format('%I.orders',s)) IS NOT NULL THEN
  FOREACH tbl IN ARRAY ARRAY['orders','ledger','purchases','accounts','inventory_moves'] LOOP EXECUTE format('SELECT count(*) FROM %I.%I',s,tbl) INTO c;n:=n+c;END LOOP;
  EXECUTE format('SELECT count(*) FROM %I.products',s) INTO products;EXECUTE format('SELECT count(*) FROM %I.media',s) INTO images;
 END IF;
 SELECT count(*) INTO c FROM public.support_tickets WHERE business_id=p_business;n:=n+c;
 RETURN jsonb_build_object('id',b.id,'name',b.name,'code',b.code,'access_alias',b.access_alias,'active',b.active,'movements',n,'products',products,'images',images,'users',(SELECT count(*) FROM public.business_members WHERE business_id=p_business),'deleted_at',b.deleted_at,'can_delete',n=0 AND b.deleted_at IS NULL);
END $function$
;

CREATE OR REPLACE FUNCTION public.business_login_slot(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_attempts integer;
begin
 delete from public.auth_login_slots where window_start<now()-interval '1 day';
 insert into public.auth_login_slots(slot_key) values(p_key) on conflict(slot_key) do update set attempts=case when auth_login_slots.window_start<now()-interval '15 minutes' then 1 else auth_login_slots.attempts+1 end,window_start=case when auth_login_slots.window_start<now()-interval '15 minutes' then now() else auth_login_slots.window_start end returning attempts into current_attempts;
 return current_attempts<=10;
end $function$
;

CREATE OR REPLACE FUNCTION public.commerce_prepare(p_business uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ BEGIN PERFORM app_internal.ensure_commerce_v2(p_business);RETURN true;END $function$
;

CREATE OR REPLACE FUNCTION public.complete_platform_setup(p_hash text, p_user uuid, p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare owner_email text; account_email text;
begin
 select email into owner_email from public.platform_setup where id=1 and token_hash=p_hash and consumed_at is null and expires_at>now() for update;
 if owner_email is null or exists(select 1 from public.platform_admins) then return false; end if;
 select email into account_email from auth.users where id=p_user;
 if account_email is null then return false; end if;
 insert into public.platform_admins(user_id,display_name,login_email,auth_email) values(p_user,p_name,lower(owner_email),account_email);
 update public.platform_setup set consumed_at=now() where id=1;
 insert into public.access_audit(actor_id,action) values(p_user,'platform.setup');
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.delete_empty_business(p_business uuid, p_actor uuid, p_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.erp_run(p_business uuid, p_commands jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE s text; cmd jsonb; q text; result jsonb:='[]'; rows jsonb; affected bigint:=0; previous bigint:=0;
BEGIN
 IF current_setting('role',true) NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'Backend only' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_commands)!='array' OR jsonb_array_length(p_commands)>1000 THEN RAISE EXCEPTION 'Invalid batch'; END IF;
 s:=app_internal.ensure_erp(p_business);
 PERFORM set_config('search_path',quote_ident(s)||',pg_catalog',true);
 PERFORM set_config('statement_timeout','8000',true);
 FOR cmd IN SELECT value FROM jsonb_array_elements(p_commands) LOOP
 q:=replace(cmd->>'sql','__ERP_CHANGES__',previous::text);
 IF q !~* '^\s*(SELECT|INSERT|UPDATE|DELETE)\s' THEN RAISE EXCEPTION 'Unsupported statement'; END IF;
 IF q ~* '^\s*SELECT\s' THEN
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM ('||q||') r' INTO rows;affected:=0;
 ELSE
 IF coalesce((cmd->>'ignore')::boolean,false) AND q !~* 'ON CONFLICT' THEN q:=q||' ON CONFLICT DO NOTHING'; END IF;
 EXECUTE q;GET DIAGNOSTICS affected=ROW_COUNT;rows:='[]';
 END IF;
 result:=result||jsonb_build_array(jsonb_build_object('results',rows,'meta',jsonb_build_object('changes',affected),'success',true));previous:=affected;
 END LOOP;
 RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.resolve_business_access(p_identifier text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT code FROM public.businesses WHERE active AND deleted_at IS NULL AND (code=p_identifier OR access_alias=p_identifier) LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.support_create_ticket(p_business uuid, p_actor uuid, p_name text, p_request uuid, p_subject text, p_category text, p_priority text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.support_heartbeat(p_business uuid, p_actor uuid, p_name text, p_role text, p_route text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 INSERT INTO public.business_presence(business_id,user_id,display_name,role,route,last_seen_at)
 SELECT p_business,p_actor,left(p_name,100),left(p_role,20),left(p_route,50),clock_timestamp()
 WHERE EXISTS(SELECT 1 FROM public.business_members m JOIN public.businesses b ON b.id=m.business_id WHERE m.user_id=p_actor AND m.business_id=p_business AND m.active AND b.active)
 ON CONFLICT(business_id,user_id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,route=excluded.route,last_seen_at=excluded.last_seen_at
 WHERE public.business_presence.last_seen_at < clock_timestamp()-interval '25 seconds'
 RETURNING true;
$function$
;

CREATE OR REPLACE FUNCTION public.support_overview()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object('server_time',now(),'businesses',coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.name),'[]'::jsonb)) FROM (
 SELECT b.id,b.code,b.name,b.access_alias,b.active,b.created_at,
 (SELECT max(p.last_seen_at) FROM public.business_presence p WHERE p.business_id=b.id) last_seen_at,
 (SELECT count(*) FROM public.business_presence p JOIN public.business_members m ON m.user_id=p.user_id AND m.business_id=p.business_id WHERE p.business_id=b.id AND p.last_seen_at>now()-interval '2 minutes' AND m.active) online_users,
 (SELECT count(*) FROM public.support_tickets t WHERE t.business_id=b.id AND t.status!='resolved') open_tickets,
 (SELECT count(*) FROM public.support_tickets t WHERE t.business_id=b.id AND (t.support_seen_at IS NULL OR t.last_customer_at>t.support_seen_at)) unread_tickets
 FROM public.businesses b WHERE b.deleted_at IS NULL) r;
$function$
;

CREATE OR REPLACE FUNCTION public.support_reply(p_ticket uuid, p_actor uuid, p_name text, p_side text, p_request uuid, p_message text, p_status text DEFAULT NULL::text, p_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.update_business_access(p_business uuid, p_name text, p_alias text, p_active boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE s text:='erp_'||replace(p_business::text,'-',''); r public.businesses;
BEGIN
 PERFORM pg_advisory_xact_lock(734390011);PERFORM pg_advisory_xact_lock(hashtextextended(s,0));
 UPDATE public.businesses SET name=p_name,access_alias=nullif(p_alias,''),active=coalesce(p_active,active) WHERE id=p_business AND deleted_at IS NULL RETURNING * INTO r;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF to_regclass(format('%I.settings',s)) IS NOT NULL THEN EXECUTE format('UPDATE %I.settings SET name=$1 WHERE id=1',s) USING p_name; END IF;
 IF NOT r.active THEN UPDATE public.support_sessions SET closed_at=now(),write_enabled=false WHERE business_id=p_business AND closed_at IS NULL; END IF;
 RETURN jsonb_build_object('id',r.id,'code',r.code,'name',r.name,'access_alias',r.access_alias,'active',r.active);
END $function$
;