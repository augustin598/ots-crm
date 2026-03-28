ALTER TABLE `debug_log` ADD `action` text;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `ip_address` text;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `user_agent` text;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `duration` integer;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `resolved` number DEFAULT false;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `resolved_at` timestamp;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `resolution_note` text;
