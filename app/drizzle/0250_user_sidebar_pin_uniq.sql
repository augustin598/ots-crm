CREATE UNIQUE INDEX IF NOT EXISTS `user_sidebar_pin_uniq` ON `user_sidebar_pin` (`user_id`, `tenant_id`, `item_id`);
