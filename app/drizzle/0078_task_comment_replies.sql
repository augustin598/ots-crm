ALTER TABLE task_comment ADD COLUMN parent_comment_id TEXT REFERENCES task_comment(id);
