-- Backfill: for any client that has at least one assigned ad account but no primary,
-- promote the lexicographically smallest id as primary. Idempotent.
UPDATE meta_ads_account
SET is_primary = 1, updated_at = current_timestamp
WHERE id IN (
  SELECT MIN(a.id)
  FROM meta_ads_account a
  WHERE a.client_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM meta_ads_account b
      WHERE b.tenant_id = a.tenant_id
        AND b.client_id = a.client_id
        AND b.is_primary = 1
    )
  GROUP BY a.tenant_id, a.client_id
);
