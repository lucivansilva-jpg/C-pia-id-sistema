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