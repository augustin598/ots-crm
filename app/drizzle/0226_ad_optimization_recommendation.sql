CREATE TABLE IF NOT EXISTS `ad_optimization_recommendation` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`target_id` text,
	`platform` text DEFAULT 'meta' NOT NULL,
	`external_campaign_id` text NOT NULL,
	`external_adset_id` text,
	`external_ad_id` text,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`metric_snapshot_json` text DEFAULT '{}' NOT NULL,
	`suggested_payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`source` text DEFAULT 'worker' NOT NULL,
	`source_worker_id` text,
	`source_api_key_id` text,
	`decided_by_user_id` text,
	`decided_at` integer,
	`applied_at` integer,
	`apply_error` text,
	`created_at` integer DEFAULT current_timestamp NOT NULL,
	`updated_at` integer DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `ad_monitor_target`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_api_key_id`) REFERENCES `api_key`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ad_optimization_recommendation_tenant_status_idx` ON `ad_optimization_recommendation` (`tenant_id`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ad_optimization_recommendation_campaign_idx` ON `ad_optimization_recommendation` (`external_campaign_id`);
