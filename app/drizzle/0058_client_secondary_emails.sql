-- Create client_secondary_email table
CREATE TABLE IF NOT EXISTS `client_secondary_email` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text NOT NULL REFERENCES `client`(`id`),
	`email` text NOT NULL,
	`label` text,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL
);
--> statement-breakpoint

-- Unique: one email per tenant (secondary email cannot be shared across clients in same tenant)
CREATE UNIQUE INDEX IF NOT EXISTS `client_secondary_email_tenant_email_idx`
	ON `client_secondary_email` (`tenant_id`, `email`);
--> statement-breakpoint

-- Add is_primary to client_user (default true for all existing rows)
ALTER TABLE `client_user` ADD COLUMN `is_primary` integer NOT NULL DEFAULT 1;
