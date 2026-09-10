CREATE TABLE `hourly_rate` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`rate_eur` integer NOT NULL,
	`sort_order` integer NOT NULL DEFAULT 0,
	`is_active` integer NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT current_timestamp,
	`updated_at` timestamp NOT NULL DEFAULT current_timestamp
);
