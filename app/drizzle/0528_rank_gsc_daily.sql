CREATE TABLE `rank_gsc_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword_id` text NOT NULL REFERENCES `rank_keyword`(`id`) ON DELETE CASCADE,
	`gsc_date` text NOT NULL,
	`device` text NOT NULL,
	`clicks` integer NOT NULL DEFAULT 0,
	`impressions` integer NOT NULL DEFAULT 0,
	`ctr` real,
	`position` real,
	`created_at` text NOT NULL DEFAULT current_timestamp,
	`updated_at` text NOT NULL DEFAULT current_timestamp
);
