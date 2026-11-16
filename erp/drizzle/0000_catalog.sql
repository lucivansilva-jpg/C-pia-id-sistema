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
