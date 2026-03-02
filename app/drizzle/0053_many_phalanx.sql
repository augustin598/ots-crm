CREATE TABLE `client_user_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`client_user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`notify_task_status_change` number DEFAULT true NOT NULL,
	`notify_new_comment` number DEFAULT true NOT NULL,
	`notify_approaching_deadline` number DEFAULT true NOT NULL,
	`notify_task_assigned` number DEFAULT true NOT NULL,
	`notify_task_approved_rejected` number DEFAULT true NOT NULL,
	`default_task_view` text DEFAULT 'card',
	`default_task_sort` text DEFAULT 'date',
	`items_per_page` integer DEFAULT 25,
	`default_priority` text DEFAULT 'medium',
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`client_user_id`) REFERENCES `client_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_user_preferences_client_user_id_unique` ON `client_user_preferences` (`client_user_id`);
