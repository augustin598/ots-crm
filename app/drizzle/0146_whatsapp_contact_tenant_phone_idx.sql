CREATE UNIQUE INDEX IF NOT EXISTS `whatsapp_contact_tenant_phone_idx` ON `whatsapp_contact` (`tenant_id`, `phone_e164`);
