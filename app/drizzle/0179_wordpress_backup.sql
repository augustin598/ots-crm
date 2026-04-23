-- Backup records for WordPress sites. `trigger` distinguishes manual user
-- backups from automatic pre-update snapshots.
CREATE TABLE IF NOT EXISTS `wordpress_backup` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`site_id` text NOT NULL REFERENCES `wordpress_site`(`id`) ON DELETE CASCADE,
	`user_id` text REFERENCES `user`(`id`),
	`trigger` text NOT NULL DEFAULT 'manual',
	`status` text NOT NULL DEFAULT 'queued',
	`archive_url` text,
	`archive_path` text,
	`size_bytes` integer,
	`error` text,
	`started_at` timestamp,
	`finished_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT current_date
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_wp_backup_tenant` ON `wordpress_backup`(`tenant_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wp_backup_site` ON `wordpress_backup`(`site_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wp_backup_status` ON `wordpress_backup`(`status`);
