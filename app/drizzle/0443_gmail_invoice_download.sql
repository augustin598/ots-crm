CREATE TABLE IF NOT EXISTS `gmail_invoice_download` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`attachment_filename` text,
	`bank_reference` text,
	`downloaded_at` timestamp DEFAULT current_timestamp NOT NULL,
	`downloaded_by_user_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`downloaded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
