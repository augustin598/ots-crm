CREATE TABLE IF NOT EXISTS `ad_metric_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`platform` text DEFAULT 'meta' NOT NULL,
	`external_campaign_id` text NOT NULL,
	`external_adset_id` text,
	`date` text NOT NULL,
	`spend_cents` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`conversions` integer DEFAULT 0 NOT NULL,
	`cpc_cents` integer,
	`cpm_cents` integer,
	`cpa_cents` integer,
	`cpl_cents` integer,
	`ctr` real,
	`roas` real,
	`frequency` real,
	`maturity` text DEFAULT 'mature' NOT NULL,
	`fetched_at` integer DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ad_metric_snapshot_uniq` ON `ad_metric_snapshot` (`tenant_id`, `external_campaign_id`, `external_adset_id`, `date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ad_metric_snapshot_tenant_date_idx` ON `ad_metric_snapshot` (`tenant_id`, `date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ad_metric_snapshot_date_idx` ON `ad_metric_snapshot` (`date`);
