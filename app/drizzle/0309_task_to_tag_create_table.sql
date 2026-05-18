CREATE TABLE `task_to_tag` (
	`task_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	PRIMARY KEY (`task_id`, `tag_id`),
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`tag_id`) REFERENCES `task_tag`(`id`) ON DELETE CASCADE
);
