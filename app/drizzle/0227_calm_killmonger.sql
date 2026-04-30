CREATE TABLE IF NOT EXISTS `ad_monitor_target_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`target_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`changes_json` text DEFAULT '{}' NOT NULL,
	`note` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `ad_monitor_target`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ad_monitor_target_audit_target_at_idx` ON `ad_monitor_target_audit` (`target_id`,`at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ad_monitor_target_audit_tenant_at_idx` ON `ad_monitor_target_audit` (`tenant_id`,`at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ad_recommendation_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`recommendation_id` text NOT NULL,
	`user_id` text,
	`rejection_reason` text NOT NULL,
	`note` text,
	`at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recommendation_id`) REFERENCES `ad_optimization_recommendation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ad_recommendation_feedback_rec_idx` ON `ad_recommendation_feedback` (`recommendation_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ad_recommendation_feedback_tenant_at_idx` ON `ad_recommendation_feedback` (`tenant_id`,`at`);--> statement-breakpoint
ALTER TABLE `ad_monitor_target` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `ad_monitor_target` ADD `external_ad_account_id` text;--> statement-breakpoint
ALTER TABLE `ad_monitor_target` ADD `custom_cooldown_hours` integer;--> statement-breakpoint
ALTER TABLE `ad_monitor_target` ADD `suppressed_actions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `ad_monitor_target` ADD `severity_override` text;--> statement-breakpoint
ALTER TABLE `ad_monitor_target` ADD `min_conversions_threshold` integer;--> statement-breakpoint
ALTER TABLE `ad_monitor_target` ADD `version` integer DEFAULT 1 NOT NULL;