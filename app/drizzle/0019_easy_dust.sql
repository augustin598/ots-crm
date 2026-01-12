CREATE TABLE `keez_client_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`keez_partner_id` text NOT NULL,
	`keez_external_id` text,
	`last_synced_at` timestamp,
	`sync_status` text DEFAULT 'synced' NOT NULL,
	`error_message` text,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `keez_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_eid` text NOT NULL,
	`application_id` text NOT NULL,
	`secret` text NOT NULL,
	`access_token` text,
	`token_expires_at` timestamp,
	`is_active` number DEFAULT true NOT NULL,
	`last_sync_at` timestamp,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keez_integration_tenant_id_unique` ON `keez_integration` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `keez_invoice_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`keez_invoice_id` text NOT NULL,
	`keez_external_id` text,
	`sync_direction` text NOT NULL,
	`last_synced_at` timestamp,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `client` ADD `keez_partner_id` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `keez_invoice_id` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `keez_external_id` text;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `keez_series` text;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `keez_start_number` text;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `keez_last_synced_number` text;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `keez_auto_sync` number DEFAULT false NOT NULL;