CREATE TABLE `ads_optimization_task` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`target_id` text NOT NULL,
	`external_campaign_id` text NOT NULL,
	`client_id` text NOT NULL,
	`type` text DEFAULT 'analyze_for_suggestions' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scheduled_for` integer NOT NULL,
	`created_at` integer NOT NULL,
	`claimed_at` integer,
	`claimed_by` text,
	`completed_at` integer,
	`result_json` text,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `ad_monitor_target`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
