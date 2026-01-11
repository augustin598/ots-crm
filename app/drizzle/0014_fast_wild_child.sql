CREATE TABLE `task_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`task_reminders_enabled` number DEFAULT true NOT NULL,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_settings_tenant_id_unique` ON `task_settings` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `task_watcher` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `invoice_emails_enabled` number DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `created_by_user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `task` ADD `last_reminder_sent_at` timestamp;