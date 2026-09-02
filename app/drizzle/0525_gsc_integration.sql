CREATE TABLE `gsc_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`email` text NOT NULL,
	`access_token_encrypted` text NOT NULL,
	`refresh_token_encrypted` text NOT NULL,
	`token_expires_at` text NOT NULL,
	`is_active` integer NOT NULL DEFAULT 1,
	`last_sync_at` text,
	`last_error` text,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
