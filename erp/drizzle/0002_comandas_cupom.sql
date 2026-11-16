ALTER TABLE `products` ADD `code` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_unique` ON `products` (`code`);--> statement-breakpoint
ALTER TABLE `settings` ADD `receipt_message` text DEFAULT 'Obrigado pela preferência! Volte sempre.' NOT NULL;