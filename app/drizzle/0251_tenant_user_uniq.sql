CREATE UNIQUE INDEX IF NOT EXISTS `tenant_user_uniq` ON `tenant_user` (`user_id`, `tenant_id`);
