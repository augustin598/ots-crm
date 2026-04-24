<?php
/**
 * WHMCS hook registrations for OTS CRM Connector.
 *
 * WHMCS auto-loads this file on every request. Hooks are declared via
 * `add_hook($point, $priority, $callable)`. We dispatch to \OtsCrm\Api
 * which handles HMAC + retry queue + dry-run logic.
 *
 * Hook points covered (per plan):
 *   - InvoiceCreated         → event=created
 *   - InvoicePaid            → event=paid
 *   - InvoiceCancelled       → event=cancelled
 *   - InvoiceRefunded        → event=refunded
 *   - ClientAdd              → event=added
 *   - ClientEdit             → event=updated
 *   - DailyCronJob           → flushRetryQueue
 *
 * Config is loaded lazily from the addon module settings row.
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/lib/Hmac.php';
require_once __DIR__ . '/lib/Api.php';
require_once __DIR__ . '/lib/RetryQueue.php';
require_once __DIR__ . '/lib/Mappers/ClientMapper.php';
require_once __DIR__ . '/lib/Mappers/InvoiceMapper.php';
require_once __DIR__ . '/lib/Extractors/TransactionIdExtractor.php';

use Illuminate\Database\Capsule\Manager as Capsule;

/**
 * Load addon config from tblconfiguration / addonmodules tables.
 * WHMCS stores per-module settings in tbladdonmodules, keyed by module name.
 *
 * Returns empty array if the module is not configured yet.
 */
function ots_crm_connector_settings(): array
{
    try {
        $rows = Capsule::table('tbladdonmodules')
            ->where('module', 'ots_crm_connector')
            ->get();

        if ($rows->isEmpty()) {
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            $out[$row->setting] = $row->value;
        }

        // Decrypt sharedSecret if WHMCS stored it encrypted
        if (!empty($out['sharedSecret'])) {
            $decrypted = localAPI('DecryptPassword', ['password2' => $out['sharedSecret']]);
            if (!empty($decrypted['password'])) {
                $out['sharedSecret'] = $decrypted['password'];
            }
        }

        return $out;
    } catch (\Throwable $e) {
        return [];
    }
}

/**
 * Guard: should we process an invoice hook?
 */
function ots_crm_connector_invoices_enabled(array $settings): bool
{
    if (empty($settings['sharedSecret']) || empty($settings['crmBaseUrl']) || empty($settings['tenantSlug'])) {
        return false;
    }
    return (($settings['eventsInvoices'] ?? 'yes') !== 'no' && ($settings['eventsInvoices'] ?? 'on') !== 'off');
}

/**
 * Guard: should we process a client hook?
 */
function ots_crm_connector_clients_enabled(array $settings): bool
{
    if (empty($settings['sharedSecret']) || empty($settings['crmBaseUrl']) || empty($settings['tenantSlug'])) {
        return false;
    }
    return (($settings['eventsClients'] ?? 'yes') !== 'no' && ($settings['eventsClients'] ?? 'on') !== 'off');
}

// ─── Invoice hooks ──────────────────────────────────────────────────────

add_hook('InvoiceCreated', 1, function (array $vars) {
    $settings = ots_crm_connector_settings();
    if (!ots_crm_connector_invoices_enabled($settings)) return;

    $payload = \OtsCrm\InvoiceMapper::fromInvoiceId((int)$vars['invoiceid'], 'created');
    if ($payload === null) return;

    \OtsCrm\Api::send($settings, 'invoices', $payload);
});

add_hook('InvoicePaid', 1, function (array $vars) {
    $settings = ots_crm_connector_settings();
    if (!ots_crm_connector_invoices_enabled($settings)) return;

    $payload = \OtsCrm\InvoiceMapper::fromInvoiceId((int)$vars['invoiceid'], 'paid');
    if ($payload === null) return;

    \OtsCrm\Api::send($settings, 'invoices', $payload);
});

add_hook('InvoiceCancelled', 1, function (array $vars) {
    $settings = ots_crm_connector_settings();
    if (!ots_crm_connector_invoices_enabled($settings)) return;

    $payload = \OtsCrm\InvoiceMapper::fromInvoiceId((int)$vars['invoiceid'], 'cancelled');
    if ($payload === null) return;

    \OtsCrm\Api::send($settings, 'invoices', $payload);
});

add_hook('InvoiceRefunded', 1, function (array $vars) {
    $settings = ots_crm_connector_settings();
    if (!ots_crm_connector_invoices_enabled($settings)) return;

    $payload = \OtsCrm\InvoiceMapper::fromInvoiceId((int)$vars['invoiceid'], 'refunded');
    if ($payload === null) return;

    \OtsCrm\Api::send($settings, 'invoices', $payload);
});

// ─── Client hooks ───────────────────────────────────────────────────────

add_hook('ClientAdd', 1, function (array $vars) {
    $settings = ots_crm_connector_settings();
    if (!ots_crm_connector_clients_enabled($settings)) return;

    $payload = \OtsCrm\ClientMapper::fromUserId((int)$vars['userid'], 'added');
    if ($payload === null) return;

    \OtsCrm\Api::send($settings, 'clients', $payload);
});

add_hook('ClientEdit', 1, function (array $vars) {
    $settings = ots_crm_connector_settings();
    if (!ots_crm_connector_clients_enabled($settings)) return;

    $payload = \OtsCrm\ClientMapper::fromUserId((int)$vars['userid'], 'updated');
    if ($payload === null) return;

    \OtsCrm\Api::send($settings, 'clients', $payload);
});

// ─── Cron: drain retry queue daily ──────────────────────────────────────

add_hook('DailyCronJob', 1, function () {
    $settings = ots_crm_connector_settings();
    if (empty($settings['sharedSecret'])) return;
    \OtsCrm\Api::flushRetryQueue($settings);
});
