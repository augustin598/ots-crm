CREATE TABLE `serp_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`provider` text NOT NULL DEFAULT 'dataforseo',
	`login_encrypted` text NOT NULL,
	`password_encrypted` text NOT NULL,
	`is_active` integer NOT NULL DEFAULT 1,
	`last_tested_at` text,
	`last_error` text,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
