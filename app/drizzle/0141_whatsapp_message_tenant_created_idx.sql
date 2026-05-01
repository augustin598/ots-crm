CREATE INDEX IF NOT EXISTS `whatsapp_message_tenant_created_idx` ON `whatsapp_message` (`tenant_id`, `created_at`);
