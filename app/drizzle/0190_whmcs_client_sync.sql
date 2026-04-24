-- WHMCS client sync tracking. match_type records how the CRM client was located:
-- existing whmcs_client_id, CUI, email, or new create.
CREATE TABLE IF NOT EXISTS `whmcs_client_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`whmcs_client_id` integer NOT NULL,
	`client_id` text REFERENCES `client`(`id`),
	`state` text NOT NULL,
	`match_type` text,
	`last_event` text,
	`last_payload_hash` text,
	`last_error_message` text,
	`raw_payload` text,
	`received_at` timestamp NOT NULL DEFAULT current_date,
	`processed_at` timestamp
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `uniq_whmcs_tenant_client` ON `whmcs_client_sync` (`tenant_id`, `whmcs_client_id`);
