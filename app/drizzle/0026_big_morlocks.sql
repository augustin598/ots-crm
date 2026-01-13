CREATE TABLE `anaf_spv_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` timestamp,
	`is_active` number DEFAULT true NOT NULL,
	`last_sync_at` timestamp,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anaf_spv_integration_tenant_id_unique` ON `anaf_spv_integration` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `anaf_spv_invoice_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`spv_id` text NOT NULL,
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
ALTER TABLE `invoice` ADD `spv_id` text;