GRANT USAGE ON SCHEMA app_internal TO service_role;
-- Private tenant schemas are provisioned only by the verified backend.
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
END $fn$;
REVOKE ALL ON FUNCTION public.erp_run(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.erp_run(uuid,jsonb) TO service_role;

DO $migration$ DECLARE s text; BEGIN FOR s IN SELECT nspname FROM pg_namespace WHERE nspname ~ '^erp_[0-9a-f]{32}$' LOOP EXECUTE format('ALTER TABLE %I.settings ADD COLUMN IF NOT EXISTS logo_key text, ADD COLUMN IF NOT EXISTS theme_color text NOT NULL DEFAULT %L',s,'#6a330d'); END LOOP; END $migration$;
