CREATE TABLE IF NOT EXISTS `admin_magic_link_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used` number DEFAULT false NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp DEFAULT current_date NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `admin_magic_link_token_token_unique` ON `admin_magic_link_token` (`token`);