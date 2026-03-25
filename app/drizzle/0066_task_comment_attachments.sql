ALTER TABLE task_comment ADD COLUMN attachment_path TEXT;--> statement-breakpoint
ALTER TABLE task_comment ADD COLUMN attachment_mime_type TEXT;--> statement-breakpoint
ALTER TABLE task_comment ADD COLUMN attachment_file_name TEXT;--> statement-breakpoint
ALTER TABLE task_comment ADD COLUMN attachment_file_size INTEGER;
