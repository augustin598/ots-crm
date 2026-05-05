CREATE TABLE `telegram_messages` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text,
  `user_id` text,
  `chat_id` text NOT NULL,
  `text_snippet` text NOT NULL,
  `ok` integer NOT NULL DEFAULT 0,
  `error_reason` text,
  `bot_message_id` integer,
  `parse_mode` text,
  `created_at` integer NOT NULL DEFAULT (cast(strftime('%s', 'now') AS integer) * 1000)
);
