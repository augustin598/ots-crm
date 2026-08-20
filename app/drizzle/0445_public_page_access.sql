CREATE TABLE IF NOT EXISTS `public_page_access` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`page_key` text NOT NULL,
	`enabled` number DEFAULT false NOT NULL,
	`password_hash` text,
	`cookie_secret` text,
	`password_updated_at` timestamp,
	`updated_by_user_id` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
