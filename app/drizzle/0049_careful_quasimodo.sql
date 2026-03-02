ALTER TABLE `expense` ADD `supplier_invoice_id` text REFERENCES supplier_invoice(id);--> statement-breakpoint
ALTER TABLE `gmail_integration` ADD `sync_enabled` number DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `gmail_integration` ADD `sync_interval` text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE `gmail_integration` ADD `sync_parser_ids` text;--> statement-breakpoint
ALTER TABLE `gmail_integration` ADD `sync_date_range_days` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `gmail_integration` ADD `last_sync_results` text;