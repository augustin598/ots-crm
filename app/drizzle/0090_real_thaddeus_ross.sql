CREATE TABLE `google_ads_spending` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`google_ads_customer_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`spend_amount` text DEFAULT '0' NOT NULL,
	`spend_cents` integer DEFAULT 0 NOT NULL,
	`currency_code` text DEFAULT 'EUR' NOT NULL,
	`impressions` integer DEFAULT 0,
	`clicks` integer DEFAULT 0,
	`conversions` integer DEFAULT 0,
	`synced_at` timestamp,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`link` text,
	`is_read` number DEFAULT false NOT NULL,
	`metadata` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `debug_log` ADD `action` text;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `ip_address` text;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `user_agent` text;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `duration` integer;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `resolved` number DEFAULT false;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `resolved_at` timestamp;--> statement-breakpoint
ALTER TABLE `debug_log` ADD `resolution_note` text;--> statement-breakpoint
ALTER TABLE `google_ads_integration` ADD `google_session_cookies` text;--> statement-breakpoint
ALTER TABLE `google_ads_integration` ADD `google_session_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `meta_invoice_download` ADD `txid` text;--> statement-breakpoint
ALTER TABLE `meta_invoice_download` ADD `invoice_number` text;--> statement-breakpoint
ALTER TABLE `meta_invoice_download` ADD `amount_text` text;--> statement-breakpoint
ALTER TABLE `meta_invoice_download` ADD `invoice_type` text DEFAULT 'invoice' NOT NULL;