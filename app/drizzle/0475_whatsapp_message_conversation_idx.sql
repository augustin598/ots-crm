CREATE INDEX `whatsapp_message_tenant_remote_created_idx` ON `whatsapp_message` (`tenant_id`, `remote_phone_e164`, `created_at`);
