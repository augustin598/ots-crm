CREATE TABLE IF NOT EXISTS `client_access_data` (
    `id` text PRIMARY KEY NOT NULL,
    `tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
    `client_id` text NOT NULL REFERENCES `client`(`id`),
    `category` text NOT NULL DEFAULT 'website',
    `label` text NOT NULL,
    `url` text,
    `username` text,
    `password` text,
    `notes` text,
    `custom_fields` text,
    `created_by_user_id` text REFERENCES `user`(`id`),
    `created_by_client_user_id` text REFERENCES `client_user`(`id`),
    `created_at` timestamp DEFAULT current_timestamp NOT NULL,
    `updated_at` timestamp DEFAULT current_timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `client_access_data_tenant_client_idx` ON `client_access_data`(`tenant_id`, `client_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `client_access_data_category_idx` ON `client_access_data`(`tenant_id`, `client_id`, `category`);
