-- WordPress sites managed centrally from the CRM.
-- Linked to tenants (required) and optionally to a client (null = agency-internal).
-- Authenticates to its WordPress via an HMAC-SHA256 secret stored encrypted in secret_key.
CREATE TABLE IF NOT EXISTS `wordpress_site` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text REFERENCES `client`(`id`),
	`name` text NOT NULL,
	`site_url` text NOT NULL,
	`secret_key` text NOT NULL,
	`connector_version` text,
	`wp_version` text,
	`php_version` text,
	`ssl_expires_at` timestamp,
	`last_health_check_at` timestamp,
	`last_uptime_ping_at` timestamp,
	`uptime_status` text NOT NULL DEFAULT 'unknown',
	`last_updates_check_at` timestamp,
	`status` text NOT NULL DEFAULT 'pending',
	`last_error` text,
	`consecutive_failures` integer NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `wordpress_site_tenant_url` ON `wordpress_site` (`tenant_id`, `site_url`);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_wordpress_site_tenant` ON `wordpress_site`(`tenant_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wordpress_site_client` ON `wordpress_site`(`client_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wordpress_site_status` ON `wordpress_site`(`status`);
