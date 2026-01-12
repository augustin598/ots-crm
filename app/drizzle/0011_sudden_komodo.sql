CREATE TABLE IF NOT EXISTS `bank_account` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`bank_name` text NOT NULL,
	`account_id` text NOT NULL,
	`iban` text NOT NULL,
	`account_name` text,
	`currency` text DEFAULT 'RON' NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`token_expires_at` timestamp,
	`is_active` number DEFAULT true NOT NULL,
	`last_synced_at` timestamp,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `bank_transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'RON' NOT NULL,
	`date` timestamp NOT NULL,
	`description` text,
	`reference` text,
	`counterpart_iban` text,
	`counterpart_name` text,
	`category` text,
	`is_expense` number DEFAULT false NOT NULL,
	`expense_id` text,
	`matched_invoice_id` text,
	`matching_method` text,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matched_invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `expense` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`bank_transaction_id` text,
	`client_id` text,
	`project_id` text,
	`category` text,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'RON' NOT NULL,
	`date` timestamp NOT NULL,
	`vat_rate` integer,
	`vat_amount` integer,
	`receipt_path` text,
	`created_by_user_id` text NOT NULL,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `transaction_invoice_match` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`matching_method` text NOT NULL,
	`matched_at` timestamp DEFAULT current_date NOT NULL,
	`matched_by_user_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `bank_transaction`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matched_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
