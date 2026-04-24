-- State machine for WHMCS invoice webhooks.
-- State: PENDING → CLIENT_MATCHED → INVOICE_CREATED → KEEZ_PUSHED. Retry skips completed steps.
-- original_total_hash snapshots line items at first sync to detect post-payment mutations.
CREATE TABLE IF NOT EXISTS `whmcs_invoice_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`whmcs_invoice_id` integer NOT NULL,
	`invoice_id` text REFERENCES `invoice`(`id`),
	`state` text NOT NULL,
	`last_event` text,
	`match_type` text,
	`last_payload_hash` text,
	`original_amount` real,
	`original_currency` text,
	`original_total_hash` text,
	`retry_count` integer NOT NULL DEFAULT 0,
	`last_error_class` text,
	`last_error_message` text,
	`raw_payload` text,
	`received_at` timestamp NOT NULL DEFAULT current_date,
	`processed_at` timestamp
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `uniq_whmcs_tenant_invoice` ON `whmcs_invoice_sync` (`tenant_id`, `whmcs_invoice_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_whmcs_invoice_sync_tenant_state` ON `whmcs_invoice_sync` (`tenant_id`, `state`);
