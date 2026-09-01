CREATE TABLE `rank_alert` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`keyword_id` text NOT NULL REFERENCES `rank_keyword`(`id`) ON DELETE cascade,
	`run_id` text NOT NULL REFERENCES `rank_run`(`id`) ON DELETE cascade,
	`device` text NOT NULL,
	`type` text NOT NULL,
	`delta` integer,
	`from_position` integer,
	`to_position` integer,
	`notified_at` text,
	`created_at` text NOT NULL DEFAULT current_timestamp
);
