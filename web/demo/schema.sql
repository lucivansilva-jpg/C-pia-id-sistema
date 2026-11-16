CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `dining_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`seats` integer,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "table_number" CHECK("dining_tables"."number">0),
	CONSTRAINT "table_seats" CHECK("dining_tables"."seats" IS NULL OR "dining_tables"."seats">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_number_unique` ON `dining_tables` (`number`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`role` text NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "employee_role" CHECK("employees"."role" IN ('waiter','cashier','admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_username_unique` ON `employees` (`username`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `product_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `media` (
	`key` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`price_cents` integer NOT NULL,
	`cost_cents` integer,
	`image_key` text,
	`active` integer DEFAULT 1 NOT NULL,
	`available` integer DEFAULT 1 NOT NULL,
	`visible` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "price_nonnegative" CHECK("products"."price_cents">=0),
	CONSTRAINT "cost_nonnegative" CHECK("products"."cost_cents" IS NULL OR "products"."cost_cents">=0),
	CONSTRAINT "product_flags" CHECK("products"."active" IN (0,1) AND "products"."available" IN (0,1) AND "products"."visible" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `products_active_name` ON `products` (`active`,`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Sua lanchonete' NOT NULL,
	`mode` text DEFAULT 'essential' NOT NULL,
	`paper` integer DEFAULT 80 NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "settings_single" CHECK("settings"."id"=1)
);

CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`settled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_request_key_unique` ON `accounts` (`request_key`);--> statement-breakpoint
CREATE TABLE `cash_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`opening_cents` integer NOT NULL,
	`counted_cents` integer,
	`expected_cents` integer,
	`difference_cents` integer,
	`actor_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	CONSTRAINT "cash_opening" CHECK("cash_sessions"."opening_cents">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_one_open` ON `cash_sessions` (`state`) WHERE "cash_sessions"."state"='open';--> statement-breakpoint
CREATE TABLE `ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`session_id` text,
	`order_id` text,
	`account_id` text,
	`kind` text NOT NULL,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`tendered_cents` integer,
	`description` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_request_key_unique` ON `ledger` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_account_id_unique` ON `ledger` (`account_id`);--> statement-breakpoint
CREATE INDEX `ledger_session` ON `ledger` (`session_id`);--> statement-breakpoint
CREATE INDEX `ledger_order` ON `ledger` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`number` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`request_key` text NOT NULL,
	`table_number` integer,
	`state` text DEFAULT 'open' NOT NULL,
	`fulfillment` text DEFAULT 'pending' NOT NULL,
	`items` text NOT NULL,
	`total_cents` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_id_unique` ON `orders` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_request_key_unique` ON `orders` (`request_key`);--> statement-breakpoint
CREATE INDEX `orders_state` ON `orders` (`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_table` ON `orders` (`table_number`) WHERE "orders"."table_number" IS NOT NULL AND ("orders"."state"='open' OR "orders"."fulfillment"!='delivered');--> statement-breakpoint
ALTER TABLE `settings` ADD `cnpj` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `legal_name` text DEFAULT '' NOT NULL;
ALTER TABLE `products` ADD `code` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_unique` ON `products` (`code`);--> statement-breakpoint
ALTER TABLE `settings` ADD `receipt_message` text DEFAULT 'Obrigado pela preferência! Volte sempre.' NOT NULL;
ALTER TABLE `products` ADD `options_json` text DEFAULT '[]' NOT NULL;
CREATE TABLE `sale_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`items` text NOT NULL,
	`state` text DEFAULT 'waiting' NOT NULL,
	`converted_order_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`converted_order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_drafts_request_key_unique` ON `sale_drafts` (`request_key`);--> statement-breakpoint
CREATE INDEX `drafts_owner_state` ON `sale_drafts` (`owner_id`,`state`);--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `counted_methods_json` text;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `expected_methods_json` text;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD `difference_methods_json` text;--> statement-breakpoint
ALTER TABLE `ledger` ADD `reversal_of` text;--> statement-breakpoint
ALTER TABLE `ledger` ADD `authorized_by` text;--> statement-breakpoint
ALTER TABLE `ledger` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `authorized_by` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `attendant_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `addons_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `quick_notes_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `blind_close` integer DEFAULT 0 NOT NULL;
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`minimum_milli` integer DEFAULT 0 NOT NULL,
	`unit_cost_micro` integer,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`kind` text NOT NULL,
	`source_id` text,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_qty_nonzero" CHECK("inventory_moves"."quantity_milli"!=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_moves_request_key_unique` ON `inventory_moves` (`request_key`);--> statement-breakpoint
CREATE INDEX `inventory_item_moves` ON `inventory_moves` (`item_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`supplier_id` text,
	`items` text NOT NULL,
	`total_cents` integer NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`due_date` text NOT NULL,
	`created_at` text NOT NULL,
	`received_at` text,
	`actor_id` text NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_request_key_unique` ON `purchases` (`request_key`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`product_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	PRIMARY KEY(`product_id`, `item_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recipe_qty_positive" CHECK("recipes"."quantity_milli">0)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`document` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `category` text DEFAULT 'Não classificado' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `recurrence` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `recurrence_parent_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `source_payment_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_recurrence_parent_id_unique` ON `accounts` (`recurrence_parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_source_payment_id_unique` ON `accounts` (`source_payment_id`);--> statement-breakpoint
ALTER TABLE `ledger` ADD `category` text DEFAULT 'Não classificado' NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger` ADD `finance_account` text DEFAULT 'bank' NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger` ADD `reconciled_at` text;--> statement-breakpoint
ALTER TABLE `ledger` ADD `external_reference` text;--> statement-breakpoint
ALTER TABLE `ledger` ADD `reconciled_by` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `closed_at` text;--> statement-breakpoint
ALTER TABLE `products` ADD `cost_mode` text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `track_stock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `credit_fee_bps` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `debit_fee_bps` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `credit_days` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `debit_days` integer DEFAULT 1 NOT NULL;
ALTER TABLE `orders` ADD `checkout_waiting` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `checkout_held_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `checkout_held_by` text;
CREATE TABLE `role_profiles` (
	`role` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`permissions` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "profile_role" CHECK("role_profiles"."role" IN ('admin','cashier','waiter'))
);
--> statement-breakpoint
ALTER TABLE `employees` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
INSERT INTO role_profiles(role,name,permissions,version,updated_at,updated_by) VALUES
('admin','Administrador / proprietário','{}',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'migration:perfis_editaveis'),
('cashier','Caixa / responsável pela operação','{}',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'migration:perfis_editaveis'),
('waiter','Garçom / atendimento','{}',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'migration:perfis_editaveis') ON CONFLICT(role) DO NOTHING;

ALTER TABLE settings ADD COLUMN business_kind TEXT NOT NULL DEFAULT 'food';ALTER TABLE settings ADD COLUMN logo_key TEXT;ALTER TABLE settings ADD COLUMN theme_color TEXT DEFAULT '#a44924';
ALTER TABLE products ADD COLUMN barcode TEXT;CREATE UNIQUE INDEX product_barcode_unique ON products(barcode);ALTER TABLE products ADD COLUMN sale_unit TEXT DEFAULT 'un';ALTER TABLE products ADD COLUMN packaging TEXT DEFAULT '';ALTER TABLE products ADD COLUMN stock_mode TEXT DEFAULT 'none';ALTER TABLE products ADD COLUMN finished_inventory_id TEXT;
CREATE TABLE customers(id TEXT PRIMARY KEY,name TEXT,phone TEXT,email TEXT,document TEXT,notes TEXT,active INTEGER,version INTEGER DEFAULT 1,created_at TEXT,updated_at TEXT);ALTER TABLE orders ADD COLUMN customer_id TEXT;ALTER TABLE orders ADD COLUMN customer_name TEXT DEFAULT '';ALTER TABLE orders ADD COLUMN exchange_from_order_id TEXT;
CREATE TABLE product_import_rows(request_key TEXT PRIMARY KEY,fingerprint TEXT,actor_id TEXT,product_id TEXT,created_at TEXT);CREATE TABLE sale_returns(id TEXT PRIMARY KEY,request_key TEXT UNIQUE,fingerprint TEXT,order_id TEXT,kind TEXT,items TEXT,amount_cents INTEGER,restored_cost_cents INTEGER,unknown_cost_quantity INTEGER,original_closed_at TEXT,replacement_order_id TEXT,actor_id TEXT,reason TEXT,created_at TEXT);CREATE TABLE sale_return_lines(return_id TEXT,item_id TEXT,product_id TEXT,quantity INTEGER,refund_cents INTEGER,restocked INTEGER,unit_cost_cents INTEGER,inventory_id TEXT,PRIMARY KEY(return_id,item_id));
CREATE TRIGGER refund_negative BEFORE INSERT ON ledger WHEN NEW.kind='refund' AND NEW.amount_cents>=0 BEGIN SELECT RAISE(ABORT,'refund_amount_negative'); END;