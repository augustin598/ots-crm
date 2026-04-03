CREATE TABLE IF NOT EXISTS `seo_link_check` (
	`id` text PRIMARY KEY NOT NULL,
	`seo_link_id` text NOT NULL,
	`checked_at` timestamp DEFAULT current_date NOT NULL,
	`status` text NOT NULL,
	`http_code` integer,
	`response_time_ms` integer,
	`error_message` text,
	FOREIGN KEY (`seo_link_id`) REFERENCES `seo_link`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `seo_link` ADD `target_url` text;--> statement-breakpoint
ALTER TABLE `seo_link` ADD `last_checked_at` timestamp;--> statement-breakpoint
ALTER TABLE `seo_link` ADD `last_check_status` text;--> statement-breakpoint
ALTER TABLE `seo_link` ADD `last_check_http_code` integer;--> statement-breakpoint
ALTER TABLE `seo_link` ADD `last_check_error` text;