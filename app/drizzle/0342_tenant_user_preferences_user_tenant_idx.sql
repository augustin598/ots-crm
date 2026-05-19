CREATE UNIQUE INDEX IF NOT EXISTS `tenant_user_preferences_user_tenant_idx` ON `tenant_user_preferences` (`user_id`, `tenant_id`);
