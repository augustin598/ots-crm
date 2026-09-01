CREATE TABLE `rank_keyword` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `rank_project`(`id`) ON DELETE cascade,
	`keyword` text NOT NULL,
	`tag` text,
	`location` text NOT NULL DEFAULT '',
	`volume` integer,
	`volume_updated_at` text,
	`difficulty` integer,
	`target_url` text,
	`active` integer NOT NULL DEFAULT 1,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
