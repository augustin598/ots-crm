CREATE TABLE IF NOT EXISTS user_whatsapp_link (
	id text PRIMARY KEY NOT NULL,
	tenant_id text NOT NULL REFERENCES tenant(id),
	user_id text NOT NULL REFERENCES user(id),
	phone_e164 text NOT NULL,
	source text NOT NULL,
	linked_at integer NOT NULL DEFAULT (unixepoch()),
	created_at integer NOT NULL DEFAULT (unixepoch())
);
