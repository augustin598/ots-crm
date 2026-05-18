CREATE TABLE `subtask` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text NOT NULL,
	`done` integer NOT NULL DEFAULT 0,
	`position` integer NOT NULL DEFAULT 0,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE
);
