ALTER TABLE `user` RENAME COLUMN "age" TO "email";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`token` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` timestamp NOT NULL,
	`accepted_at` timestamp,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `invitation_token_unique` ON `invitation` (`token`);--> statement-breakpoint
DROP INDEX IF EXISTS `user_username_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS "invitation_token_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "tenant_slug_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "tenant_cui_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "user_email_unique";--> statement-breakpoint
ALTER TABLE `user` ALTER COLUMN "email" TO "email" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tenant_slug_unique` ON `tenant` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tenant_cui_unique` ON `tenant` (`cui`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_email_unique` ON `user` (`email`);--> statement-breakpoint
ALTER TABLE `user` ALTER COLUMN "username" TO "username" text;--> statement-breakpoint
ALTER TABLE `user` ADD `first_name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `last_name` text NOT NULL;