ALTER TABLE `orders` ADD `checkout_waiting` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `checkout_held_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `checkout_held_by` text;