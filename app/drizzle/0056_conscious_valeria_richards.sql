ALTER TABLE `task_settings` ADD `client_emails_enabled` number DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `task_settings` ADD `client_email_on_task_created` number DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `task_settings` ADD `client_email_on_status_change` number DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `task_settings` ADD `client_email_on_comment` number DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `task_settings` ADD `client_email_on_task_modified` number DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `task_settings` ADD `internal_email_on_comment` number DEFAULT true NOT NULL;