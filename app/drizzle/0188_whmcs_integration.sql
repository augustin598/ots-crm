-- WHMCS integration credentials + circuit breaker state (per-tenant).
-- shared_secret is encrypted via lib/server/crypto.
-- enable_keez_push starts false so tenants go through a dry-run phase before fiscal sync activates.
CREATE TABLE IF NOT EXISTS `whmcs_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`whmcs_url` text NOT NULL,
	`shared_secret` text NOT NULL,
	`is_active` integer NOT NULL DEFAULT 0,
	`enable_keez_push` integer NOT NULL DEFAULT 0,
	`circuit_breaker_until` timestamp,
	`consecutive_failures` integer NOT NULL DEFAULT 0,
	`last_successful_sync_at` timestamp,
	`last_failure_reason` text,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `whmcs_integration_tenant_id_unique` ON `whmcs_integration` (`tenant_id`);
