CREATE TABLE `password_reset_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used` number DEFAULT false NOT NULL,
	`used_at` timestamp,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_token_token_unique` ON `password_reset_token` (`token`);