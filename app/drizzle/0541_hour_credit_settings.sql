CREATE TABLE `hour_credit_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`reference_rate_slug` text,
	`low_credit_threshold_minutes` integer NOT NULL DEFAULT 120,
	`step_minutes` integer NOT NULL DEFAULT 15,
	`notify_email` integer NOT NULL DEFAULT 1,
	`notify_whatsapp` integer NOT NULL DEFAULT 1,
	`updated_by_user_id` text REFERENCES `user`(`id`),
	`created_at` timestamp NOT NULL DEFAULT current_timestamp,
	`updated_at` timestamp NOT NULL DEFAULT current_timestamp
);
