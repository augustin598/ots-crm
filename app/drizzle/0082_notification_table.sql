-- Notification table for in-app notifications (SSE-based)
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`user_id` text NOT NULL REFERENCES `user`(`id`),
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`link` text,
	`is_read` integer NOT NULL DEFAULT 0,
	`metadata` text,
	`created_at` timestamp DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notification_user_read_idx` ON `notification`(`user_id`, `is_read`);
--> statement-breakpoint
CREATE INDEX `notification_tenant_user_idx` ON `notification`(`tenant_id`, `user_id`);
