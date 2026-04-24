<?php
/**
 * OTS CRM Connector — WHMCS Addon Module
 *
 * Sends invoice + client lifecycle events from this WHMCS installation
 * to the OTS CRM via HMAC-signed webhooks. The CRM is source of truth:
 * it matches clients by CUI/email, creates invoices with the dedicated
 * hosting series, and (when enabled) pushes them to Keez for fiscal
 * compliance.
 *
 * Replaces the legacy `keez_integration` module.
 *
 * Admin UI: Setup > Addon Modules > OTS CRM Connector
 *   - Displays config (CRM URL, tenant slug, shared secret)
 *   - "Test connection" button probes /health on the CRM side
 *   - "Rotate secret" regenerates the HMAC key (shown ONCE)
 *
 * @package    OtsCrmConnector
 * @author     One Top Solution
 * @copyright  2026 One Top Solution SRL
 * @link       https://clients.onetopsolution.ro
 * @version    1.0.0
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

/**
 * Module metadata + admin-configurable settings.
 * WHMCS reads these on Setup > Addon Modules to render the config form.
 */
function ots_crm_connector_config(): array
{
    return [
        'name'        => 'OTS CRM Connector',
        'description' => 'Trimite facturile + clienții din WHMCS către OTS CRM '
                       . '(care le propagă apoi la Keez). HMAC-signed webhooks. '
                       . 'Înlocuiește modulul vechi keez_integration.',
        'author'      => 'One Top Solution',
        'language'    => 'romanian',
        'version'     => '1.0.0',
        'fields'      => [
            'crmBaseUrl' => [
                'FriendlyName' => 'CRM Base URL',
                'Type'         => 'text',
                'Size'         => '60',
                'Default'      => 'https://clients.onetopsolution.ro',
                'Description'  => 'Fără slash la final. Ex: <code>https://clients.onetopsolution.ro</code>',
            ],
            'tenantSlug' => [
                'FriendlyName' => 'Tenant Slug',
                'Type'         => 'text',
                'Size'         => '30',
                'Default'      => 'ots',
                'Description'  => 'Slug-ul tenant-ului din CRM. Apare în URL, ex: <code>/ots/…</code>',
            ],
            'sharedSecret' => [
                'FriendlyName' => 'Shared Secret (HMAC)',
                'Type'         => 'text',
                'Size'         => '80',
                'Description'  => '64 hex chars. Generat de CRM la setup/rotate. NU împărți. '
                                . '(Stocat plaintext — WHMCS password-type corupe valoarea la decrypt.)',
            ],
            'eventsInvoices' => [
                'FriendlyName' => 'Trimite evenimente facturi',
                'Type'         => 'yesno',
                'Default'      => 'yes',
                'Description'  => 'InvoiceCreated / InvoicePaid / InvoiceCancelled / InvoiceRefunded',
            ],
            'eventsClients' => [
                'FriendlyName' => 'Trimite evenimente clienți',
                'Type'         => 'yesno',
                'Default'      => 'yes',
                'Description'  => 'ClientAdd / ClientEdit',
            ],
            'dryRun' => [
                'FriendlyName' => 'Dry-run mode (log only)',
                'Type'         => 'yesno',
                'Default'      => 'no',
                'Description'  => 'Loghează local ce AR TRIMITE, dar nu face POST. Pentru debugging.',
            ],
            'timeoutSec' => [
                'FriendlyName' => 'Timeout HTTP (secunde)',
                'Type'         => 'text',
                'Size'         => '5',
                'Default'      => '15',
                'Description'  => 'Max timeout per request către CRM. Default 15.',
            ],
        ],
    ];
}

/**
 * Activation hook: create retry queue table for webhooks that fail transiently.
 */
function ots_crm_connector_activate(): array
{
    try {
        \OtsCrm\RetryQueue::install();
        logActivity('OTS CRM Connector activated — retry queue table ready.');
        return ['status' => 'success', 'description' => 'Modul activat. Configurează în fila Settings.'];
    } catch (\Throwable $e) {
        return [
            'status'      => 'error',
            'description' => 'Activare eșuată: ' . $e->getMessage(),
        ];
    }
}

/**
 * Deactivation hook. We do NOT drop the retry queue — operator may want to
 * inspect failures before uninstalling. Admin can drop the table manually.
 */
function ots_crm_connector_deactivate(): array
{
    logActivity('OTS CRM Connector deactivated.');
    return ['status' => 'success', 'description' => 'Modul dezactivat. Tabela de retry rămâne pentru audit.'];
}

/**
 * Admin UI — rendered inside Addon Modules > OTS CRM Connector.
 * Shows health status, retry queue counts, and a "Test Connection" button.
 */
function ots_crm_connector_output(array $vars): void
{
    $modulelink = $vars['modulelink'];
    $version    = $vars['version'];
    $crmBaseUrl = rtrim((string)($vars['crmBaseUrl'] ?? ''), '/');
    $tenantSlug = trim((string)($vars['tenantSlug'] ?? ''));
    $hasSecret  = !empty($vars['sharedSecret']);

    // Handle "Test connection" action
    $testResult = null;
    if (($_GET['action'] ?? null) === 'test' && $hasSecret && $crmBaseUrl && $tenantSlug) {
        $testResult = \OtsCrm\Api::testConnection($vars);
    }

    // Retry queue stats
    $retryStats = \OtsCrm\RetryQueue::stats();

    echo '<h3>OTS CRM Connector — v' . htmlspecialchars($version) . '</h3>';
    echo '<p>Webhook base URL: <code>' . htmlspecialchars($crmBaseUrl . '/' . $tenantSlug . '/api/webhooks/whmcs') . '</code></p>';

    if (!$hasSecret) {
        echo '<div style="padding:10px;background:#fff3cd;border:1px solid #ffc107;margin:10px 0;">';
        echo '<strong>⚠ Shared Secret neconfigurat.</strong> ';
        echo 'Deschide CRM → Setări → WHMCS, apasă „Configurează", copiază secretul generat, ';
        echo 'și lipește-l aici în fila <em>Settings</em>.';
        echo '</div>';
    }

    // Test Connection button
    if ($hasSecret && $crmBaseUrl && $tenantSlug) {
        echo '<p>';
        echo '<a href="' . htmlspecialchars($modulelink . '&action=test') . '" class="btn btn-primary">🔗 Test Connection</a>';
        echo '</p>';

        if ($testResult !== null) {
            if ($testResult['ok']) {
                echo '<div style="padding:10px;background:#d1e7dd;border:1px solid #198754;margin:10px 0;">';
                echo '<strong>✓ Conexiune reușită.</strong> ';
                echo 'Tenant: <code>' . htmlspecialchars($testResult['tenantSlug']) . '</code>, ';
                echo 'Connector: <code>' . htmlspecialchars($testResult['connectorVersion']) . '</code>, ';
                echo 'Mod: <strong>' . ($testResult['dryRun'] ? 'DRY-RUN (CRM nu pushează la Keez)' : 'LIVE') . '</strong>';
                echo '</div>';
            } else {
                echo '<div style="padding:10px;background:#f8d7da;border:1px solid #dc3545;margin:10px 0;">';
                echo '<strong>✗ Eșec:</strong> ' . htmlspecialchars($testResult['reason']);
                if (!empty($testResult['httpStatus'])) {
                    echo ' (HTTP ' . (int)$testResult['httpStatus'] . ')';
                }
                echo '</div>';
            }
        }
    }

    // Retry queue stats
    echo '<h4>Retry queue</h4>';
    echo '<table class="table table-bordered" style="width:auto;">';
    echo '<tr><td>Pending</td><td><strong>' . (int)$retryStats['pending'] . '</strong></td></tr>';
    echo '<tr><td>Failed permanent</td><td><strong>' . (int)$retryStats['failed'] . '</strong></td></tr>';
    echo '<tr><td>Total</td><td><strong>' . (int)$retryStats['total'] . '</strong></td></tr>';
    echo '</table>';

    if ($retryStats['pending'] > 0) {
        echo '<p>';
        echo '<a href="' . htmlspecialchars($modulelink . '&action=flush') . '" class="btn btn-default">🔁 Flush queue now</a>';
        echo '</p>';

        if (($_GET['action'] ?? null) === 'flush') {
            $flushed = \OtsCrm\Api::flushRetryQueue($vars);
            echo '<div style="padding:10px;background:#d1e7dd;border:1px solid #198754;margin:10px 0;">';
            echo '<strong>Queue flush:</strong> ' . (int)$flushed['sent'] . ' trimise OK, ';
            echo (int)$flushed['stillPending'] . ' încă pending, ';
            echo (int)$flushed['failed'] . ' markate fail.';
            echo '</div>';
        }
    }

    echo '<h4>Ghid rapid</h4>';
    echo '<ol>';
    echo '<li>În CRM → <em>Setări → Integrare WHMCS</em> → apasă <strong>Configurează WHMCS</strong>.</li>';
    echo '<li>Copiază URL-ul CRM (de obicei <code>https://clients.onetopsolution.ro</code>) și tenant slug-ul.</li>';
    echo '<li>Copiază secretul afișat ONCE și lipește-l aici (fila Settings → Shared Secret).</li>';
    echo '<li>Apasă <strong>Test Connection</strong> pentru a verifica.</li>';
    echo '<li>În CRM, activează switch-ul „Integrare activă".</li>';
    echo '<li><strong>Dezactivează modulul vechi <em>keez_integration</em>!</strong> Altfel apar duplicate în Keez.</li>';
    echo '</ol>';
}
