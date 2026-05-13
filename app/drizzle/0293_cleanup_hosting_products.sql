-- Cleanup: remove leftover auto-created rows from a removed sync script,
-- and null out HTML-laden descriptions imported from WHMCS so admins re-enter
-- them as plain summary + features JSON via the new admin form.
DELETE FROM `hosting_product`
WHERE `description` = 'Auto-created product from Server Sync Tool'
  AND `price` = 0
  AND `whmcs_product_id` IS NULL;

UPDATE `hosting_product`
SET `description` = NULL
WHERE `description` LIKE '%<%>%';
