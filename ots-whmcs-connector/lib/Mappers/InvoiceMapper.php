<?php
/**
 * Map a WHMCS invoice + its items + client to the canonical
 * `WhmcsInvoicePayload` the OTS CRM `/invoices` endpoint expects.
 *
 * TS type reference:
 *   app/src/lib/server/whmcs/types.ts → WhmcsInvoicePayload
 */

namespace OtsCrm;

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

use Illuminate\Database\Capsule\Manager as Capsule;

class InvoiceMapper
{
    /**
     * Build the full invoice payload.
     *
     * @param int    $invoiceId  WHMCS invoice id
     * @param string $event      'created' | 'paid' | 'cancelled' | 'refunded'
     */
    public static function fromInvoiceId(int $invoiceId, string $event): ?array
    {
        $invoice = Capsule::table('tblinvoices')->where('id', $invoiceId)->first();
        if (!$invoice) return null;

        $items = Capsule::table('tblinvoiceitems')
            ->where('invoiceid', $invoiceId)
            ->get();

        $client = ClientMapper::fromUserId((int)$invoice->userid, 'updated');
        if ($client === null) return null;

        // Currency ID → ISO code
        $currencyCode = 'RON';
        if (!empty($invoice->userid)) {
            $currencyRow = Capsule::table('tblcurrencies')
                ->join('tblclients', 'tblclients.currency', '=', 'tblcurrencies.id')
                ->where('tblclients.id', (int)$invoice->userid)
                ->select('tblcurrencies.code')
                ->first();
            if ($currencyRow && !empty($currencyRow->code)) {
                $currencyCode = strtoupper((string)$currencyRow->code);
            }
        }

        // Tax rate: WHMCS has taxrate (primary) + taxrate2 (secondary). We
        // sum into a single percent for the CRM side; the CRM's VAT field
        // accepts a single rate per line item.
        $totalTaxRate = (float)($invoice->taxrate ?? 0) + (float)($invoice->taxrate2 ?? 0);

        // Extract Stripe txn id (multiple fallback sources — see extractor)
        $transactionId = TransactionIdExtractor::extract($invoiceId);

        return [
            'event'               => $event,
            'whmcsInvoiceId'      => (int)$invoice->id,
            'whmcsInvoiceNumber'  => !empty($invoice->invoicenum)
                ? (string)$invoice->invoicenum
                : (string)$invoice->id,
            'issueDate'           => (string)$invoice->date,
            'dueDate'             => !empty($invoice->duedate) ? (string)$invoice->duedate : null,
            'status'              => (string)($invoice->status ?? 'Unpaid'),
            'subtotal'            => (float)$invoice->subtotal,
            'tax'                 => (float)$invoice->tax + (float)$invoice->tax2,
            'total'               => (float)$invoice->total,
            'currency'            => $currencyCode,
            'paymentMethod'       => !empty($invoice->paymentmethod) ? (string)$invoice->paymentmethod : null,
            'transactionId'       => $transactionId !== '' ? $transactionId : null,
            'notes'               => !empty($invoice->notes) ? (string)$invoice->notes : null,
            'client'              => $client,
            'items'               => array_values(array_map(
                fn($item) => self::mapItem($item, $totalTaxRate),
                $items->toArray()
            )),
        ];
    }

    private static function mapItem($item, float $fallbackTaxRate): array
    {
        // WHMCS invoiceitem.amount is the line total (already qty * unitprice).
        // No explicit "quantity" column; we infer 1 unless description mentions N×.
        $qty = 1.0;
        $amount = (float)($item->amount ?? 0);
        $unitPrice = $amount;

        // `taxed` is a bool flag; the actual rate lives on the parent invoice.
        $vat = ((int)($item->taxed ?? 0) === 1) ? $fallbackTaxRate : 0.0;

        return [
            'whmcsItemId'    => (int)$item->id,
            'externalItemId' => self::stableItemGuid($item),
            'description'    => (string)($item->description ?? 'Hosting'),
            'quantity'       => $qty,
            'unitPrice'      => round($unitPrice, 2),
            'vatPercent'     => round($vat, 2),
            'relId'          => !empty($item->relid) ? (int)$item->relid : null,
            'relIdType'      => !empty($item->type) ? (string)$item->type : null,
        ];
    }

    /**
     * Deterministic GUID per WHMCS item id, so the CRM can dedupe on
     * line-item level and so the same item always maps to the same Keez
     * item code. Format matches the legacy keez_integration output:
     * 32 hex chars (MD5 over a stable composite key).
     */
    private static function stableItemGuid($item): string
    {
        $composite = 'whmcs:' . (int)($item->id ?? 0)
                   . ':' . (string)($item->type ?? '')
                   . ':' . (int)($item->relid ?? 0);
        return md5($composite);
    }
}
