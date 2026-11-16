-- Migration registrada no Supabase. Rever antes de aplicar em outro ambiente.
-- Additive, private per-business commercial data. No existing sales are rewritten.
CREATE OR REPLACE FUNCTION app_internal.ensure_commerce(p_business uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
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
 EXECUTE format('CREATE TABLE %I.commerce_version(version integer PRIMARY KEY)',s);
 EXECUTE format('INSERT INTO %I.commerce_version VALUES(1)',s);
 EXECUTE format('ALTER TABLE %I.commerce_version ENABLE ROW LEVEL SECURITY',s);
 EXECUTE format('CREATE POLICY backend_only ON %I.commerce_version FOR SELECT TO service_role USING(true)',s);
 EXECUTE format('GRANT SELECT ON %I.commerce_version TO service_role',s);
 RETURN s;
END $fn$;
REVOKE ALL ON FUNCTION app_internal.ensure_commerce(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_internal.ensure_commerce(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.commerce_prepare(p_business uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN PERFORM app_internal.ensure_commerce(p_business); RETURN true; END $fn$;
REVOKE ALL ON FUNCTION public.commerce_prepare(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_prepare(uuid) TO service_role;

