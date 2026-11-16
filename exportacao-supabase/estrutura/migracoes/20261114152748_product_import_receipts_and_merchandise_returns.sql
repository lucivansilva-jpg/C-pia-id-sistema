-- Migration registrada no Supabase. Rever antes de aplicar em outro ambiente.
CREATE OR REPLACE FUNCTION app_internal.ensure_commerce_v2(p_business uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
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
END $f$;
REVOKE ALL ON FUNCTION app_internal.ensure_commerce_v2(uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION app_internal.ensure_commerce_v2(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.commerce_prepare(p_business uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$ BEGIN PERFORM app_internal.ensure_commerce_v2(p_business);RETURN true;END $f$;

