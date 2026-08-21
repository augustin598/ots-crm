ALTER TABLE `whatsapp_session` ADD `owner_instance_id` text;--> statement-breakpoint
ALTER TABLE `whatsapp_session` ADD `heartbeat_at` timestamp;--> statement-breakpoint
ALTER TABLE `whatsapp_session` ADD `stale_alert_at` timestamp;
