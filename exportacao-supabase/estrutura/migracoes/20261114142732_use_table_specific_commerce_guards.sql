-- Migration registrada no Supabase. Rever antes de aplicar em outro ambiente.
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

