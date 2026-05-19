CREATE TABLE IF NOT EXISTS google_calendar_integration (
	id text PRIMARY KEY NOT NULL,
	tenant_id text NOT NULL REFERENCES tenant(id),
	email text NOT NULL,
	access_token_encrypted text NOT NULL,
	refresh_token_encrypted text NOT NULL,
	token_expires_at integer NOT NULL,
	is_active integer NOT NULL DEFAULT 1,
	last_refresh_attempt_at integer,
	last_refresh_error text,
	consecutive_refresh_failures integer DEFAULT 0,
	granted_scopes text,
	created_at integer NOT NULL DEFAULT (unixepoch()),
	updated_at integer NOT NULL DEFAULT (unixepoch())
);
