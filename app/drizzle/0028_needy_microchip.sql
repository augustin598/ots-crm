PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_anaf_spv_invoice_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text,
	`expense_id` text,
	`tenant_id` text NOT NULL,
	`spv_id` text NOT NULL,
	`sync_direction` text NOT NULL,
	`last_synced_at` timestamp,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`created_at` timestamp DEFAULT current_date NOT NULL,
	`updated_at` timestamp DEFAULT current_date NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`expense_id`) REFERENCES `expense`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_anaf_spv_invoice_sync`("id", "invoice_id", "expense_id", "tenant_id", "spv_id", "sync_direction", "last_synced_at", "sync_status", "error_message", "created_at", "updated_at") SELECT "id", "invoice_id", "expense_id", "tenant_id", "spv_id", "sync_direction", "last_synced_at", "sync_status", "error_message", "created_at", "updated_at" FROM `anaf_spv_invoice_sync`;--> statement-breakpoint
DROP TABLE `anaf_spv_invoice_sync`;--> statement-breakpoint
ALTER TABLE `__new_anaf_spv_invoice_sync` RENAME TO `anaf_spv_invoice_sync`;--> statement-breakpoint
PRAGMA foreign_keys=ON;