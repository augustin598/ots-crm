CREATE TABLE IF NOT EXISTS `personalops_instance` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`last_heartbeat_at` timestamp NOT NULL,
	`version` text,
	`metadata` text,
	`created_at` timestamp NOT NULL DEFAULT current_timestamp,
	`updated_at` timestamp NOT NULL DEFAULT current_timestamp,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
