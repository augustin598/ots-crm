-- Audit trail for apply-updates actions. One row per user-initiated batch.
-- `items` and `result` are JSON-encoded text columns.
CREATE TABLE IF NOT EXISTS `wordpress_update_job` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`site_id` text NOT NULL REFERENCES `wordpress_site`(`id`) ON DELETE CASCADE,
	`user_id` text REFERENCES `user`(`id`),
	`items` text NOT NULL DEFAULT '[]',
	`status` text NOT NULL DEFAULT 'queued',
	`result` text,
	`error` text,
	`started_at` timestamp,
	`finished_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT current_date
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_wp_update_job_tenant` ON `wordpress_update_job`(`tenant_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wp_update_job_site` ON `wordpress_update_job`(`site_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wp_update_job_status` ON `wordpress_update_job`(`status`);
