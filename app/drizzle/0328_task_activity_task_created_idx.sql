CREATE INDEX IF NOT EXISTS task_activity_task_created_idx ON task_activity(task_id, created_at DESC);
