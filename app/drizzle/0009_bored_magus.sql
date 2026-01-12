CREATE TABLE IF NOT EXISTS `document_template` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`variables` text,
	`styling` text,
	`is_active` number DEFAULT true NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `document` ADD `document_template_id` text REFERENCES document_template(id);--> statement-breakpoint
ALTER TABLE `document` ADD `rendered_content` text;--> statement-breakpoint
ALTER TABLE `document` ADD `pdf_generated` number DEFAULT false NOT NULL;