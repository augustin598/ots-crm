UPDATE `client_secondary_email` SET `receives_invoice_emails` = 1 WHERE `access_flags` IS NULL AND `notify_invoices` = 1;
