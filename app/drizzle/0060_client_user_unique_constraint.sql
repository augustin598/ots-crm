CREATE UNIQUE INDEX IF NOT EXISTS `client_user_unique_idx` ON `client_user` (`user_id`, `client_id`, `tenant_id`);
