CREATE TABLE `email_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`smtp_host` text,
	`smtp_port` integer DEFAULT 587,
	`smtp_secure` number DEFAULT false,
	`smtp_user` text,
	`smtp_password` text,
	`smtp_from` text,
	`is_enabled` number DEFAULT true NOT NULL,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_settings_tenant_id_unique` ON `email_settings` (`tenant_id`);