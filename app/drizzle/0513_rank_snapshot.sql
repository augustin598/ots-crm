CREATE TABLE `rank_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword_id` text NOT NULL REFERENCES `rank_keyword`(`id`) ON DELETE cascade,
	`device` text NOT NULL,
	`checked_at` text NOT NULL,
	`day_key` text NOT NULL,
	`position` integer,
	`page` integer,
	`ranking_url` text,
	`serp_features` text NOT NULL DEFAULT '[]',
	`ai_overview` text NOT NULL DEFAULT 'absent',
	`competitors` text NOT NULL DEFAULT '{}',
	`top_results` text NOT NULL DEFAULT '[]',
	`provider` text NOT NULL DEFAULT 'scraper',
	`created_at` text NOT NULL DEFAULT current_timestamp
);
