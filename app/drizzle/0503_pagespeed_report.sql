CREATE TABLE `pagespeed_report` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`week_key` text NOT NULL,
	`sent_at` timestamp,
	`site_count` integer DEFAULT 0 NOT NULL,
	`avg_mobile` integer,
	`avg_desktop` integer,
	`delta_mobile` integer,
	`alert_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`note` text,
	`recipients` text DEFAULT '[]' NOT NULL,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
