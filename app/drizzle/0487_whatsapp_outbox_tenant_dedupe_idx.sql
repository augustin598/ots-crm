CREATE INDEX `whatsapp_outbox_tenant_dedupe_idx` ON `whatsapp_outbox` (`tenant_id`,`dedupe_key`);
