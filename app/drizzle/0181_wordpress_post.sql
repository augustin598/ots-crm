-- Cache of WP posts synced into the CRM. WP is the source of truth;
-- this table is rebuilt from /posts on demand and updated on each push.
CREATE TABLE IF NOT EXISTS `wordpress_post` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`site_id` text NOT NULL REFERENCES `wordpress_site`(`id`) ON DELETE CASCADE,
	`wp_post_id` integer NOT NULL,
	`title` text NOT NULL DEFAULT '',
	`slug` text NOT NULL DEFAULT '',
	`status` text NOT NULL DEFAULT 'draft',
	`content_html` text NOT NULL DEFAULT '',
	`excerpt` text,
	`featured_media_id` integer,
	`featured_media_url` text,
	`author_wp_id` integer,
	`link` text,
	`published_at` timestamp,
	`last_synced_at` timestamp NOT NULL DEFAULT current_date,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `wp_post_site_wpid` ON `wordpress_post` (`site_id`, `wp_post_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wp_post_tenant` ON `wordpress_post`(`tenant_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wp_post_site` ON `wordpress_post`(`site_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wp_post_status` ON `wordpress_post`(`status`);
