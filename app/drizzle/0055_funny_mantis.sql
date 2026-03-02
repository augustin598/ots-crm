ALTER TABLE `invoice` ADD `overdue_reminder_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice` ADD `last_overdue_reminder_at` timestamp;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `send_invoice_email_enabled` number DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `paid_confirmation_email_enabled` number DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `overdue_reminder_enabled` number DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `overdue_reminder_days_after_due` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `overdue_reminder_repeat_days` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `overdue_reminder_max_count` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_settings` ADD `auto_send_recurring_invoices` number DEFAULT false NOT NULL;