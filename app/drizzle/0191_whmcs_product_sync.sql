-- WHMCS product sync tracking. v1 logs-only (no auto-creation of CRM services).
-- Schema provisioned now so v2 activation needs no DDL deploy.
CREATE TABLE IF NOT EXISTS `whmcs_product_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`whmcs_product_id` integer NOT NULL,
	`service_id` text REFERENCES `service`(`id`),
	`state` text NOT NULL DEFAULT 'LOGGED',
	`last_payload_hash` text,
	`raw_payload` text,
	`received_at` timestamp NOT NULL DEFAULT current_date
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `uniq_whmcs_tenant_product` ON `whmcs_product_sync` (`tenant_id`, `whmcs_product_id`);
