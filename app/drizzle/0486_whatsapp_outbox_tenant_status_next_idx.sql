CREATE INDEX `whatsapp_outbox_tenant_status_next_idx` ON `whatsapp_outbox` (`tenant_id`,`status`,`next_attempt_at`);
