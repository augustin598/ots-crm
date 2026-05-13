ALTER TABLE `processed_stripe_event` ADD `status` text DEFAULT 'completed' NOT NULL;
--> statement-breakpoint
ALTER TABLE `processed_stripe_event` ADD `started_at` text;
--> statement-breakpoint
ALTER TABLE `processed_stripe_event` ADD `completed_at` text;
--> statement-breakpoint
ALTER TABLE `processed_stripe_event` ADD `error_message` text;
--> statement-breakpoint
ALTER TABLE `processed_stripe_event` ADD `retry_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `processed_stripe_event_status_idx` ON `processed_stripe_event` (`status`);
