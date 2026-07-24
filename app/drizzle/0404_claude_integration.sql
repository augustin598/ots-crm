CREATE TABLE IF NOT EXISTS `claude_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`api_key_encrypted` text NOT NULL,
	`key_type` text NOT NULL,
	`key_hint` text NOT NULL,
	`default_model` text DEFAULT 'claude-sonnet-5' NOT NULL,
	`is_active` number DEFAULT true NOT NULL,
	`last_tested_at` timestamp,
	`last_error` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
