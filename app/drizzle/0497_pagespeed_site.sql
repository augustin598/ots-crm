CREATE TABLE `pagespeed_site` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text,
	`domain` text NOT NULL,
	`name` text NOT NULL,
	`cms` text DEFAULT 'WordPress' NOT NULL,
	`pages` text DEFAULT '[]' NOT NULL,
	`strategies` text DEFAULT '["mobile","desktop"]' NOT NULL,
	`alert_threshold` integer DEFAULT 5 NOT NULL,
	`active` number DEFAULT true NOT NULL,
	`paused_at` timestamp,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
