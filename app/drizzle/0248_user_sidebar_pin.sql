CREATE TABLE IF NOT EXISTS `user_sidebar_pin` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `tenant_id` text NOT NULL,
  `item_id` text NOT NULL,
  `position` integer NOT NULL DEFAULT 0,
  `created_at` text DEFAULT (current_timestamp) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`),
  FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`)
);
