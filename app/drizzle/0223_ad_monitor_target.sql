CREATE TABLE IF NOT EXISTS `ad_monitor_target` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`platform` text DEFAULT 'meta' NOT NULL,
	`external_campaign_id` text NOT NULL,
	`external_adset_id` text,
	`objective` text NOT NULL,
	`target_cpl_cents` integer,
	`target_cpa_cents` integer,
	`target_roas` real,
	`target_ctr` real,
	`target_daily_budget_cents` integer,
	`deviation_threshold_pct` integer DEFAULT 20 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`is_muted` integer DEFAULT 0 NOT NULL,
	`muted_until` integer,
	`notify_telegram` integer DEFAULT 1 NOT NULL,
	`notify_email` integer DEFAULT 1 NOT NULL,
	`notify_in_app` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT current_timestamp NOT NULL,
	`updated_at` integer DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ad_monitor_target_tenant_active_idx` ON `ad_monitor_target` (`tenant_id`, `is_active`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ad_monitor_target_client_idx` ON `ad_monitor_target` (`client_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ad_monitor_target_uniq` ON `ad_monitor_target` (`tenant_id`, `external_campaign_id`, `external_adset_id`);
