CREATE TABLE `rank_report` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`week_key` text NOT NULL,
	`sent_at` text,
	`project_count` integer NOT NULL DEFAULT 0,
	`keyword_count` integer NOT NULL DEFAULT 0,
	`avg_position` real,
	`visibility` real,
	`delta_visibility` real,
	`top_up` text NOT NULL DEFAULT '[]',
	`top_down` text NOT NULL DEFAULT '[]',
	`distribution` text NOT NULL DEFAULT '{}',
	`alert_count` integer NOT NULL DEFAULT 0,
	`status` text NOT NULL DEFAULT 'sent',
	`note` text,
	`recipients` text NOT NULL DEFAULT '[]',
	`created_at` text NOT NULL DEFAULT current_timestamp
);
