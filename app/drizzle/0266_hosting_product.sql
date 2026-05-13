CREATE TABLE `hosting_product` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`da_server_id` text,
	`da_package_id` text,
	`name` text NOT NULL,
	`description` text,
	`price` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'RON' NOT NULL,
	`billing_cycle` text DEFAULT 'monthly' NOT NULL,
	`setup_fee` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`whmcs_product_id` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`da_server_id`) REFERENCES `da_server`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`da_package_id`) REFERENCES `da_package`(`id`) ON UPDATE no action ON DELETE set null
);
