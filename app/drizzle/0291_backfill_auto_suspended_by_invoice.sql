-- Backfill auto_suspended_by_invoice_id from suspend_reason strings created by the
-- DA plugin before this FK existed. The plugin always wrote reasons in the form
-- "Overdue invoice <invoiceNumber>", so we resolve the invoice via its number
-- scoped to the same tenant. Staff-edited reasons that don't match are left null.
UPDATE `hosting_account`
SET `auto_suspended_by_invoice_id` = (
    SELECT `invoice`.`id`
    FROM `invoice`
    WHERE `invoice`.`tenant_id` = `hosting_account`.`tenant_id`
      AND `invoice`.`invoice_number` = REPLACE(`hosting_account`.`suspend_reason`, 'Overdue invoice ', '')
    LIMIT 1
)
WHERE `hosting_account`.`status` = 'suspended'
  AND `hosting_account`.`suspend_reason` LIKE 'Overdue invoice %';
