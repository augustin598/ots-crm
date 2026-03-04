CREATE TABLE `marketing_material` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`category` text DEFAULT 'google-ads' NOT NULL,
	`type` text DEFAULT 'image' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`file_path` text,
	`file_size` integer,
	`mime_type` text,
	`file_name` text,
	`text_content` text,
	`dimensions` text,
	`external_url` text,
	`seo_link_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`uploaded_by_user_id` text,
	`uploaded_by_client_user_id` text,
	`campaign_type` text,
	`tags` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`seo_link_id`) REFERENCES `seo_link`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_client_user_id`) REFERENCES `client_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_marketing_material` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`task_id` text NOT NULL,
	`marketing_material_id` text NOT NULL,
	`added_by_user_id` text NOT NULL,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`marketing_material_id`) REFERENCES `marketing_material`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `seo_link` ADD `extracted_links` text;--> statement-breakpoint
ALTER TABLE `tenant` ADD `theme_color` text;