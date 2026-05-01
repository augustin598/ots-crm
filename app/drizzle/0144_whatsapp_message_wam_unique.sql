CREATE UNIQUE INDEX IF NOT EXISTS `whatsapp_message_wam_unique_idx` ON `whatsapp_message` (`tenant_id`, `wam_id`);
