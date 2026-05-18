CREATE TABLE task_comment_reaction (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES task_comment(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
