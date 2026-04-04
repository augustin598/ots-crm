CREATE TABLE IF NOT EXISTS `saved_report_view` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`user_id` text NOT NULL REFERENCES `user`(`id`),
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`filters` text NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
