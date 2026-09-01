CREATE TABLE `rank_project` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text REFERENCES `client`(`id`),
	`domain` text NOT NULL,
	`name` text NOT NULL,
	`locale` text NOT NULL DEFAULT 'google.ro|ro',
	`locations` text NOT NULL DEFAULT '["România"]',
	`competitors` text NOT NULL DEFAULT '[]',
	`devices` text NOT NULL DEFAULT '["desktop","mobile"]',
	`alert_threshold` integer NOT NULL DEFAULT 5,
	`active` integer NOT NULL DEFAULT 1,
	`paused_at` text,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
