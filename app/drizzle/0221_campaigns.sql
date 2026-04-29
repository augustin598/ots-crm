CREATE TABLE IF NOT EXISTS `campaign` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`platform` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`build_step` text DEFAULT 'none' NOT NULL,
	`build_attempts` integer DEFAULT 0 NOT NULL,
	`external_campaign_id` text,
	`external_adset_id` text,
	`external_creative_id` text,
	`external_ad_id` text,
	`external_ad_account_id` text,
	`name` text NOT NULL,
	`objective` text NOT NULL,
	`budget_type` text NOT NULL,
	`budget_cents` integer NOT NULL,
	`currency_code` text DEFAULT 'RON' NOT NULL,
	`audience_json` text DEFAULT '{}' NOT NULL,
	`creative_json` text DEFAULT '{}' NOT NULL,
	`brief_json` text DEFAULT '{}' NOT NULL,
	`created_by_worker_id` text,
	`created_by_api_key_id` text,
	`approved_by_user_id` text,
	`approved_at` integer,
	`paused_by_user_id` text,
	`paused_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT current_timestamp NOT NULL,
	`updated_at` integer DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_api_key_id`) REFERENCES `api_key`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paused_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `campaign_tenant_status_idx` ON `campaign` (`tenant_id`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `campaign_client_idx` ON `campaign` (`client_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `campaign_external_uidx` ON `campaign` (`platform`, `external_campaign_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `campaign_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`error_message` text,
	`at` integer DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `campaign_audit_campaign_idx` ON `campaign_audit` (`campaign_id`, `at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `campaign_idempotency` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`api_key_id` text NOT NULL,
	`response_status` integer DEFAULT 0 NOT NULL,
	`response_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT current_timestamp NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_key`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `campaign_idem_tenant_key_uidx` ON `campaign_idempotency` (`tenant_id`, `idempotency_key`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meta_targeting_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`query` text NOT NULL,
	`payload_json` text NOT NULL,
	`fetched_at` integer DEFAULT current_timestamp NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `meta_targeting_cache_type_query_uidx` ON `meta_targeting_cache` (`type`, `query`);
