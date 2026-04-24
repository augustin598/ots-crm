-- WHMCS transaction sync tracking. v1 logs-only; v2 will link to bank transactions
-- for reconciliation. whmcs_transaction_id is text to support gateway-specific formats.
CREATE TABLE IF NOT EXISTS `whmcs_transaction_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`whmcs_transaction_id` text NOT NULL,
	`bank_transaction_id` text,
	`state` text NOT NULL DEFAULT 'LOGGED',
	`last_payload_hash` text,
	`raw_payload` text,
	`received_at` timestamp NOT NULL DEFAULT current_date
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `uniq_whmcs_tenant_transaction` ON `whmcs_transaction_sync` (`tenant_id`, `whmcs_transaction_id`);
