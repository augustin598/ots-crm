CREATE TABLE `task_comment_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`path` text NOT NULL,
	`mime_type` text,
	`file_name` text,
	`file_size` integer,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `task_comment`(`id`) ON UPDATE no action ON DELETE cascade
);
