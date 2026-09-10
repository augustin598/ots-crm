CREATE TABLE `hourly_rate_mode` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`suffix` text NOT NULL DEFAULT '',
	`description` text NOT NULL DEFAULT '',
	`sla` text NOT NULL DEFAULT '',
	`multiplier_pct` integer NOT NULL DEFAULT 100,
	`max_hours` integer NOT NULL DEFAULT 100,
	`sort_order` integer NOT NULL DEFAULT 0,
	`is_active` integer NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT current_timestamp,
	`updated_at` timestamp NOT NULL DEFAULT current_timestamp
);
