CREATE TABLE IF NOT EXISTS `content_import_job` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_articles` integer DEFAULT 0 NOT NULL,
	`processed_articles` integer DEFAULT 0 NOT NULL,
	`ok_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`thin_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` timestamp,
	`finished_at` timestamp,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
