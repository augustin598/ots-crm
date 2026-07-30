CREATE TABLE IF NOT EXISTS `task_email` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`task_id` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`gmail_thread_id` text,
	`subject` text,
	`from_email` text,
	`snippet` text,
	`email_date` timestamp,
	`linked_by_user_id` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
