CREATE TABLE `hosting_email_event` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `hosting_account_id` text NOT NULL,
  `event_type` text NOT NULL,
  `dedupe_key` text NOT NULL,
  `email_log_id` text,
  `attempt_number` integer DEFAULT 1 NOT NULL,
  `sent_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`),
  FOREIGN KEY (`hosting_account_id`) REFERENCES `hosting_account`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`email_log_id`) REFERENCES `email_log`(`id`)
);
