CREATE TABLE `da_server` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`hostname` text NOT NULL,
	`port` integer DEFAULT 2222 NOT NULL,
	`username_encrypted` text NOT NULL,
	`password_encrypted` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`last_checked_at` text,
	`last_error` text,
	`da_version` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
