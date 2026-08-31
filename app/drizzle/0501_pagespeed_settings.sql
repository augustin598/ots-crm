CREATE TABLE `pagespeed_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`day_of_week` integer DEFAULT 1 NOT NULL,
	`hour` text DEFAULT '07:00' NOT NULL,
	`strategies` text DEFAULT '["mobile","desktop"]' NOT NULL,
	`recipients` text DEFAULT '[]' NOT NULL,
	`alert_threshold` integer DEFAULT 5 NOT NULL,
	`only_on_drop` number DEFAULT false NOT NULL,
	`include_opportunities` number DEFAULT true NOT NULL,
	`attach_pdf` number DEFAULT false NOT NULL,
	`send_to_client` number DEFAULT false NOT NULL,
	`is_enabled` number DEFAULT true NOT NULL,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
