CREATE TABLE IF NOT EXISTS `interview_channel` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#94a3b8' NOT NULL,
	`icon` text DEFAULT 'circle-help' NOT NULL,
	`is_system` number DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
