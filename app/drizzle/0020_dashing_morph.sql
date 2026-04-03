CREATE TABLE IF NOT EXISTS `supplier` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`company_type` text,
	`cui` text,
	`registration_number` text,
	`trade_register` text,
	`vat_number` text,
	`legal_representative` text,
	`iban` text,
	`bank_name` text,
	`address` text,
	`city` text,
	`county` text,
	`postal_code` text,
	`country` text DEFAULT 'România',
	`notes` text,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_bank_account` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`iban` text NOT NULL,
	`bank_name` text,
	`account_name` text,
	`currency` text DEFAULT 'RON' NOT NULL,
	`is_active` number DEFAULT true NOT NULL,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `expense` ADD `supplier_id` text REFERENCES supplier(id);--> statement-breakpoint
ALTER TABLE `expense` ADD `invoice_path` text;