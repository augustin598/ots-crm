CREATE TABLE `debug_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`level` text DEFAULT 'info' NOT NULL,
	`source` text DEFAULT 'server' NOT NULL,
	`message` text NOT NULL,
	`url` text,
	`stack_trace` text,
	`metadata` text,
	`user_id` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`email_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`error_message` text,
	`smtp_message_id` text,
	`smtp_response` text,
	`processed_at` timestamp,
	`completed_at` timestamp,
	`metadata` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
