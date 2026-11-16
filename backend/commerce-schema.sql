-- Enforce the same rules for older browser sessions using the previous API.
CREATE OR REPLACE FUNCTION app_internal.commerce_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $guard$
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
END $guard$;
REVOKE ALL ON FUNCTION app_internal.commerce_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_internal.commerce_guard() TO service_role;
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
 EXECUTE format('CREATE TRIGGER commerce_orders_guard BEFORE INSERT ON %I.orders FOR EACH ROW EXECUTE FUNCTION app_internal.commerce_guard()',s);
 EXECUTE format('CREATE TRIGGER commerce_settings_guard BEFORE UPDATE OF business_kind ON %I.settings FOR EACH ROW EXECUTE FUNCTION app_internal.commerce_guard()',s);
 EXECUTE format('CREATE TRIGGER commerce_stock_guard BEFORE INSERT ON %I.inventory_moves FOR EACH ROW EXECUTE FUNCTION app_internal.commerce_guard()',s);
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

DO $existing$ DECLARE s text; BEGIN
 FOR s IN SELECT nspname FROM pg_namespace WHERE nspname ~ '^erp_[0-9a-f]{32}$' LOOP
  IF to_regclass(format('%I.commerce_version',s)) IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='commerce_orders_guard' AND tgrelid=to_regclass(format('%I.orders',s))) THEN
    EXECUTE format('CREATE TRIGGER commerce_orders_guard BEFORE INSERT ON %I.orders FOR EACH ROW EXECUTE FUNCTION app_internal.commerce_guard()',s);
    EXECUTE format('CREATE TRIGGER commerce_settings_guard BEFORE UPDATE OF business_kind ON %I.settings FOR EACH ROW EXECUTE FUNCTION app_internal.commerce_guard()',s);
    EXECUTE format('CREATE TRIGGER commerce_stock_guard BEFORE INSERT ON %I.inventory_moves FOR EACH ROW EXECUTE FUNCTION app_internal.commerce_guard()',s);
   END IF;
  END IF;
 END LOOP;
END $existing$;
