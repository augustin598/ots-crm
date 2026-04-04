CREATE TABLE IF NOT EXISTS `report_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text NOT NULL REFERENCES `client`(`id`),
	`frequency` text DEFAULT 'disabled' NOT NULL,
	`day_of_week` integer DEFAULT 1,
	`day_of_month` integer DEFAULT 1,
	`platforms` text DEFAULT '["meta","google","tiktok"]' NOT NULL,
	`recipient_emails` text,
	`is_enabled` integer DEFAULT 0 NOT NULL,
	`last_sent_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
