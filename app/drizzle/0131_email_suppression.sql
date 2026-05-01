CREATE TABLE IF NOT EXISTS `email_suppression` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text REFERENCES `tenant`(`id`),
	`email` text NOT NULL,
	`reason` text NOT NULL,
	`smtp_code` text,
	`smtp_message` text,
	`source_email_log_id` text,
	`created_at` timestamp DEFAULT (current_timestamp) NOT NULL
);
