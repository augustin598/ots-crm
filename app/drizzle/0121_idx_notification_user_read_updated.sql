CREATE INDEX notification_user_read_updated_idx ON notification(user_id, is_read, updated_at);
