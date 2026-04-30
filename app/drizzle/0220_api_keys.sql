CREATE TABLE IF NOT EXISTS `api_key` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `api_key_hash_uidx` ON `api_key` (`key_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `api_key_tenant_idx` ON `api_key` (`tenant_id`);
