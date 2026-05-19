CREATE TABLE IF NOT EXISTS `tenant_user_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`notify_task_assigned` number DEFAULT true NOT NULL,
	`notify_new_comment` number DEFAULT true NOT NULL,
	`notify_task_status_change` number DEFAULT true NOT NULL,
	`notify_task_approved_rejected` number DEFAULT true NOT NULL,
	`notify_task_reopened` number DEFAULT true NOT NULL,
	`notify_mention` number DEFAULT true NOT NULL,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE cascade
);
