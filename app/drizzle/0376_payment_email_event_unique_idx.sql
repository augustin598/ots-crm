CREATE UNIQUE INDEX `payment_email_event_unique` ON `payment_email_event` (`tenant_id`, `invoice_id`, `dedupe_key`);
