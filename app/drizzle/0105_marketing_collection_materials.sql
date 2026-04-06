CREATE TABLE IF NOT EXISTS `marketing_collection_material` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL REFERENCES `marketing_collection`(`id`) ON DELETE CASCADE,
	`material_id` text NOT NULL REFERENCES `marketing_material`(`id`) ON DELETE CASCADE,
	`added_at` timestamp NOT NULL DEFAULT current_timestamp
);
