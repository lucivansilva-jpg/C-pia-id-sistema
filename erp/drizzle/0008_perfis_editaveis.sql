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
