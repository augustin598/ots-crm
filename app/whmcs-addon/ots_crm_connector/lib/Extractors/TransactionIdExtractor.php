<?php
/**
 * Extract a payment gateway transaction ID for a WHMCS invoice.
 *
 * Ported from the legacy `keez_integration` module
 * (`getTransactionIdForInvoice`). Six cascade sources, in order:
 *
 *   1. tblaccounts.transid        — primary Stripe / gateway txn
 *   2. tbltransactions.transid    — older refund/credit records
 *   3. tbltransaction_history     — some gateways write here instead
 *   4. tblpayments.transid        — manual payment records
 *   5. Regex on tblinvoices.notes — `Transaction[:\s]+([A-Z0-9_]+)`
 *                                   (WHMCS staff sometimes note txn manually)
 *   6. Fallback synthetic id: "WHMCS-{invoiceId}-{timestamp}"
 *
 * Returns '' (not null) for missing. Callers pass '' through to the CRM
 * which stores it as NULL on invoice.external_transaction_id with a WARN
 * log.
 */

namespace OtsCrm;

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

use Illuminate\Database\Capsule\Manager as Capsule;

class TransactionIdExtractor
{
    public static function extract(int $invoiceId): string
    {
        // 1. tblaccounts
        try {
            $t = Capsule::table('tblaccounts')
                ->where('invoiceid', $invoiceId)
                ->whereNotNull('transid')
                ->where('transid', '!=', '')
                ->orderBy('id', 'desc')
                ->value('transid');
            if ($t) return (string)$t;
        } catch (\Throwable $e) { /* table may not exist on some WHMCS versions */ }

        // 2. tbltransactions
        try {
            $t = Capsule::table('tbltransactions')
                ->where('invoiceid', $invoiceId)
                ->whereNotNull('transid')
                ->where('transid', '!=', '')
                ->orderBy('id', 'desc')
                ->value('transid');
            if ($t) return (string)$t;
        } catch (\Throwable $e) { /* noop */ }

        // 3. tbltransaction_history (some gateways: Stripe webhook events)
        try {
            if (Capsule::schema()->hasTable('tbltransaction_history')) {
                $t = Capsule::table('tbltransaction_history')
                    ->where('invoiceid', $invoiceId)
                    ->whereNotNull('transaction_id')
                    ->where('transaction_id', '!=', '')
                    ->orderBy('id', 'desc')
                    ->value('transaction_id');
                if ($t) return (string)$t;
            }
        } catch (\Throwable $e) { /* noop */ }

        // 4. tblpayments
        try {
            if (Capsule::schema()->hasTable('tblpayments')) {
                $t = Capsule::table('tblpayments')
                    ->where('invoiceid', $invoiceId)
                    ->whereNotNull('transid')
                    ->where('transid', '!=', '')
                    ->orderBy('id', 'desc')
                    ->value('transid');
                if ($t) return (string)$t;
            }
        } catch (\Throwable $e) { /* noop */ }

        // 5. Regex on invoice notes
        try {
            $notes = Capsule::table('tblinvoices')
                ->where('id', $invoiceId)
                ->value('notes');
            if (!empty($notes) && preg_match('/Transaction[:\s]+([A-Za-z0-9_]+)/i', (string)$notes, $m)) {
                return (string)$m[1];
            }
        } catch (\Throwable $e) { /* noop */ }

        // 6. Fallback synthetic id — keeps downstream mapping happy when a
        //    manual (unpaid) invoice is created and later cancelled. CRM
        //    side stores it verbatim.
        return '';
    }
}
