CREATE TABLE `task_assignee` (
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role` text DEFAULT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`task_id`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE
);
