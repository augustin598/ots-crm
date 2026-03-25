ALTER TABLE google_ads_integration ADD COLUMN google_session_cookies TEXT;--> statement-breakpoint
ALTER TABLE google_ads_integration ADD COLUMN google_session_status TEXT NOT NULL DEFAULT 'none';
