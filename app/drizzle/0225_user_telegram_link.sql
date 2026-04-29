CREATE TABLE IF NOT EXISTS `user_telegram_link` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`telegram_chat_id` text,
	`telegram_username` text,
	`link_code` text NOT NULL,
	`linked_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_telegram_link_code_uidx` ON `user_telegram_link` (`link_code`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_telegram_link_user_uidx` ON `user_telegram_link` (`tenant_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_telegram_link_chat_idx` ON `user_telegram_link` (`telegram_chat_id`);
