CREATE TABLE IF NOT EXISTS `invoice_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`smartbill_series` text,
	`smartbill_start_number` text,
	`smartbill_last_synced_number` text,
	`smartbill_auto_sync` number DEFAULT false NOT NULL,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `invoice_settings_tenant_id_unique` ON `invoice_settings` (`tenant_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `plugin` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`version` text NOT NULL,
	`is_active` number DEFAULT true NOT NULL,
	`config` text,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `plugin_name_unique` ON `plugin` (`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `smartbill_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`is_active` number DEFAULT true NOT NULL,
	`last_sync_at` timestamp,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `smartbill_integration_tenant_id_unique` ON `smartbill_integration` (`tenant_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `smartbill_invoice_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`smartbill_series` text NOT NULL,
	`smartbill_number` text NOT NULL,
	`smartbill_cif` text NOT NULL,
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
CREATE TABLE IF NOT EXISTS `tenant_plugin` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`is_active` number DEFAULT true NOT NULL,
	`config` text,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugin`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `invoice` ADD `smartbill_series` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `smartbill_number` text;