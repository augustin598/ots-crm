-- Delete duplicate leads, keeping the oldest (first imported) for each (tenant_id, external_lead_id, platform)
DELETE FROM lead
WHERE id NOT IN (
  SELECT MIN(id) FROM lead
  GROUP BY tenant_id, external_lead_id, platform
);
