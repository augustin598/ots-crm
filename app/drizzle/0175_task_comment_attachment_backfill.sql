INSERT OR IGNORE INTO `task_comment_attachment` (`id`, `comment_id`, `path`, `mime_type`, `file_name`, `file_size`, `created_at`)
SELECT `id`, `id`, `attachment_path`, `attachment_mime_type`, `attachment_file_name`, `attachment_file_size`, `created_at`
FROM `task_comment`
WHERE `attachment_path` IS NOT NULL;
