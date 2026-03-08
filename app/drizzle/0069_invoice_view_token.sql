CREATE TABLE IF NOT EXISTS `invoice_view_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`invoice_id` text NOT NULL REFERENCES `invoice`(`id`) ON DELETE CASCADE,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`created_at` text DEFAULT (current_date) NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `invoice_view_token_token_unique` ON `invoice_view_token` (`token`);
