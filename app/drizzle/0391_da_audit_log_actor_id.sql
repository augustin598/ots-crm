ALTER TABLE da_audit_log ADD COLUMN actor_id TEXT REFERENCES "user"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS da_audit_log_actor_idx ON da_audit_log(actor_id);
