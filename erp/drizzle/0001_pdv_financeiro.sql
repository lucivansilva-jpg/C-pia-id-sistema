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