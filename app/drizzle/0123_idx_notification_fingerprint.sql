CREATE UNIQUE INDEX notification_fingerprint_idx ON notification(fingerprint) WHERE fingerprint IS NOT NULL;
