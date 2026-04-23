-- Cache of pending core/plugin/theme updates per WordPress site.
-- Snapshot table — wiped and re-inserted every time we refresh updates.
CREATE TABLE IF NOT EXISTS `wordpress_pending_update` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`site_id` text NOT NULL REFERENCES `wordpress_site`(`id`) ON DELETE CASCADE,
	`type` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL DEFAULT '',
	`current_version` text NOT NULL DEFAULT '',
	`new_version` text NOT NULL DEFAULT '',
	`security_update` integer NOT NULL DEFAULT 0,
	`auto_update` integer NOT NULL DEFAULT 0,
	`detected_at` timestamp NOT NULL DEFAULT current_date
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `wp_pending_update_site_slug` ON `wordpress_pending_update` (`site_id`, `type`, `slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wp_pending_update_tenant` ON `wordpress_pending_update`(`tenant_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wp_pending_update_security` ON `wordpress_pending_update`(`security_update`);
