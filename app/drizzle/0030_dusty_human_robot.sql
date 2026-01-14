ALTER TABLE `invoice` ADD `invoice_series` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `invoice_currency` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `payment_terms` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `payment_method` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `exchange_rate` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `vat_on_collection` number DEFAULT false;--> statement-breakpoint
ALTER TABLE `invoice` ADD `is_credit_note` number DEFAULT false;--> statement-breakpoint
ALTER TABLE `invoice` ADD `discount_type` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `discount_value` integer;--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `service_id` text REFERENCES service(id);--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `tax_rate` integer;--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `discount_type` text;--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `discount` integer;--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `note` text;--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `currency` text;--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `unit_of_measure` text;--> statement-breakpoint
ALTER TABLE `invoice_line_item` ADD `keez_item_external_id` text;