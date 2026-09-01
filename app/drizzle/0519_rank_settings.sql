CREATE TABLE `rank_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`check_hour` text NOT NULL DEFAULT '06:00',
	`report_day` integer NOT NULL DEFAULT 1,
	`report_hour` text NOT NULL DEFAULT '07:00',
	`recipients` text NOT NULL DEFAULT '[]',
	`send_to_client` integer NOT NULL DEFAULT 0,
	`attach_pdf` integer NOT NULL DEFAULT 1,
	`archive_to_client` integer NOT NULL DEFAULT 1,
	`alerts_enabled` integer NOT NULL DEFAULT 1,
	`provider_mode` text NOT NULL DEFAULT 'scraper',
	`is_enabled` integer NOT NULL DEFAULT 1,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
