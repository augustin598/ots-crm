CREATE TABLE `hosting_inquiry` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`hosting_product_id` text,
	`contact_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`contact_phone` text,
	`company_name` text,
	`vat_number` text,
	`message` text,
	`status` text DEFAULT 'new' NOT NULL,
	`client_id` text,
	`source` text DEFAULT 'pachete-hosting' NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` text DEFAULT (current_date) NOT NULL,
	`updated_at` text DEFAULT (current_date) NOT NULL,
	`contacted_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`),
	FOREIGN KEY (`hosting_product_id`) REFERENCES `hosting_product`(`id`) ON DELETE SET NULL,
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`) ON DELETE SET NULL
);
CREATE INDEX `hosting_inquiry_tenant_idx` ON `hosting_inquiry` (`tenant_id`);
CREATE INDEX `hosting_inquiry_status_idx` ON `hosting_inquiry` (`status`);
CREATE INDEX `hosting_inquiry_created_idx` ON `hosting_inquiry` (`created_at`);
