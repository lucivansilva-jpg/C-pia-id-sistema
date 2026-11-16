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