CREATE TABLE `payment_email_event` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `invoice_id` text NOT NULL,
  `event_type` text NOT NULL,
  `dedupe_key` text NOT NULL,
  `email_log_id` text,
  `sent_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`),
  FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`email_log_id`) REFERENCES `email_log`(`id`)
);
