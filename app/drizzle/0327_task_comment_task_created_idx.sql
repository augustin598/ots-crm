CREATE INDEX IF NOT EXISTS task_comment_task_created_idx ON task_comment(task_id, created_at);
