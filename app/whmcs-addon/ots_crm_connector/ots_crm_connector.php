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
require_once __DIR__ . '/lib/NonceStore.php';
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
        \OtsCrm\NonceStore::install();
        logActivity('OTS CRM Connector activated — retry queue + nonce dedup tables ready.');
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

    // Handle "Resend invoice" action — manual retrigger (for historical backfill
    // or replay after a CRM downtime). Builds the payload with the same mapper
    // the hooks use, so behavior is identical.
    $resendResult = null;
    $resendInvoiceId = (int)($_GET['resend_invoice'] ?? 0);
    if ($resendInvoiceId > 0 && $hasSecret && $crmBaseUrl && $tenantSlug) {
        $resendEvent = (string)($_GET['resend_event'] ?? 'created'); // default to 'created' for a dry backfill
        $validEvents = ['created', 'paid', 'cancelled', 'refunded'];
        if (!in_array($resendEvent, $validEvents, true)) {
            $resendEvent = 'created';
        }
        $payload = \OtsCrm\InvoiceMapper::fromInvoiceId($resendInvoiceId, $resendEvent);
        if ($payload === null) {
            $resendResult = ['ok' => false, 'reason' => 'invoice_not_found', 'invoiceId' => $resendInvoiceId];
        } else {
            $ok = \OtsCrm\Api::send($vars, 'invoices', $payload);
            $resendResult = ['ok' => $ok, 'event' => $resendEvent, 'invoiceId' => $resendInvoiceId, 'number' => $payload['whmcsInvoiceNumber'] ?? ''];
        }
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

    // Resend result banner
    if ($resendResult !== null) {
        if ($resendResult['ok']) {
            echo '<div style="padding:10px;background:#d1e7dd;border:1px solid #198754;margin:10px 0;">';
            echo '<strong>✓ Invoice ' . htmlspecialchars($resendResult['number'] ?? ('#' . $resendResult['invoiceId'])) . ' resent to CRM</strong> ';
            echo '(event=' . htmlspecialchars($resendResult['event']) . ').';
            echo '</div>';
        } else {
            echo '<div style="padding:10px;background:#f8d7da;border:1px solid #dc3545;margin:10px 0;">';
            echo '<strong>✗ Resend failed for invoice #' . (int)$resendResult['invoiceId'] . ':</strong> ';
            echo htmlspecialchars($resendResult['reason'] ?? 'network_error');
            echo '</div>';
        }
    }

    // Recent invoices + manual resend — useful for backfilling invoices created
    // before the connector was live, or for debugging after a CRM outage.
    if ($hasSecret && $crmBaseUrl && $tenantSlug) {
        ots_crm_connector_render_invoices_table($modulelink, $vars);
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

/**
 * Renders a table of the last 30 WHMCS invoices with a per-row "Resend to CRM"
 * action. Useful for:
 *   - Backfilling invoices that predate the connector's activation
 *   - Replaying after a CRM outage (the retry queue covers transients, this
 *     covers invoices whose payload has since changed)
 *   - Spot-checking which invoices would be a CUI match in CRM (warning icon
 *     flags invoices with missing/empty tax_id)
 */
function ots_crm_connector_render_invoices_table(string $modulelink, array $vars): void
{
    try {
        $rows = \Illuminate\Database\Capsule\Manager::table('tblinvoices as i')
            ->leftJoin('tblclients as c', 'c.id', '=', 'i.userid')
            ->orderBy('i.id', 'desc')
            ->limit(30)
            ->select([
                'i.id',
                'i.invoicenum',
                'i.date',
                'i.total',
                'i.status',
                'c.companyname',
                'c.firstname',
                'c.lastname',
                'c.tax_id',
            ])
            ->get();
    } catch (\Throwable $e) {
        echo '<p style="color:#dc3545;">Could not list invoices: ' . htmlspecialchars($e->getMessage()) . '</p>';
        return;
    }

    if ($rows->isEmpty()) {
        return;
    }

    // Bulk-fetch CRM + Keez status for all rows in one HMAC round-trip.
    $invoiceIds = [];
    foreach ($rows as $r) {
        $invoiceIds[] = (int)$r->id;
    }
    $statuses = \OtsCrm\Api::fetchInvoiceStatuses($vars, $invoiceIds);

    echo '<h4 style="margin-top:24px;">Facturi WHMCS recente (ultimele 30)</h4>';
    echo '<p style="color:#666;font-size:13px;">';
    echo 'Folosește butonul <i class="fas fa-paper-plane"></i> pentru a retrimite manual la CRM (util pentru istoric).';
    echo ' <i class="fas fa-exclamation-triangle text-warning"></i> în coloana CUI = factura nu se va potrivi în CRM după CUI (se va încerca email sau se va crea client nou).';
    echo '</p>';

    echo '<table class="table table-striped table-hover" style="font-size:13px;">';
    echo '<thead>';
    echo '<tr>';
    echo '<th>ID</th>';
    echo '<th>Număr</th>';
    echo '<th>Client</th>';
    echo '<th>CUI</th>';
    echo '<th>Data</th>';
    echo '<th>Total</th>';
    echo '<th>Status WHMCS</th>';
    echo '<th>Status Keez</th>';
    echo '<th style="width:130px;">Acțiuni</th>';
    echo '</tr>';
    echo '</thead><tbody>';

    foreach ($rows as $r) {
        $clientName = !empty($r->companyname)
            ? $r->companyname
            : trim(((string)($r->firstname ?? '')) . ' ' . ((string)($r->lastname ?? '')));
        $hasCui = !empty(trim((string)($r->tax_id ?? '')));
        $cuiCell = $hasCui
            ? '<span class="text-success" title="CUI: ' . htmlspecialchars((string)$r->tax_id) . '"><i class="fas fa-check"></i> ' . htmlspecialchars((string)$r->tax_id) . '</span>'
            : '<span class="text-warning" title="CUI lipsă — CRM va încerca match pe email"><i class="fas fa-exclamation-triangle"></i> lipsă</span>';

        $statusLower = strtolower((string)$r->status);
        $statusClass = [
            'paid'       => 'background:#d1e7dd;color:#0f5132;',
            'unpaid'     => 'background:#f8d7da;color:#842029;',
            'cancelled'  => 'background:#e2e3e5;color:#41464b;',
            'refunded'   => 'background:#cff4fc;color:#055160;',
            'collections'=> 'background:#fff3cd;color:#664d03;',
        ][$statusLower] ?? 'background:#e9ecef;color:#495057;';

        // Keez status cell — derived from CRM bulk status response
        $keezCell = ots_crm_connector_keez_status_cell($statuses[(string)(int)$r->id] ?? null);

        $whmcsLink    = 'invoices.php?action=edit&id=' . (int)$r->id;
        $resendCreated = htmlspecialchars($modulelink . '&resend_invoice=' . (int)$r->id . '&resend_event=created');
        $resendPaid    = htmlspecialchars($modulelink . '&resend_invoice=' . (int)$r->id . '&resend_event=paid');

        echo '<tr>';
        echo '<td>' . (int)$r->id . '</td>';
        echo '<td><strong>' . htmlspecialchars((string)($r->invoicenum ?: '(draft)')) . '</strong></td>';
        echo '<td>' . htmlspecialchars($clientName) . '</td>';
        echo '<td>' . $cuiCell . '</td>';
        echo '<td>' . htmlspecialchars(date('d.m.Y', strtotime((string)$r->date))) . '</td>';
        echo '<td>' . number_format((float)$r->total, 2) . '</td>';
        echo '<td><span style="padding:2px 8px;border-radius:3px;font-size:12px;' . $statusClass . '">' . htmlspecialchars((string)$r->status) . '</span></td>';
        echo '<td>' . $keezCell . '</td>';
        echo '<td>';
        echo '<a href="' . htmlspecialchars($whmcsLink) . '" target="_blank" class="btn btn-sm btn-default" title="Deschide factura în WHMCS"><i class="fas fa-external-link-alt"></i></a> ';
        echo '<a href="' . $resendCreated . '" onclick="return confirm(\'Trimite factura ' . (int)$r->id . ' la CRM ca eveniment `created`?\');" class="btn btn-sm btn-info" title="Resend ca event=created"><i class="fas fa-paper-plane"></i></a>';
        if ($statusLower === 'paid') {
            echo ' <a href="' . $resendPaid . '" onclick="return confirm(\'Trimite factura ' . (int)$r->id . ' la CRM ca eveniment `paid`?\');" class="btn btn-sm btn-success" title="Resend ca event=paid"><i class="fas fa-money-check-alt"></i></a>';
        }
        echo '</td>';
        echo '</tr>';
    }

    echo '</tbody></table>';

    // Legend
    echo '<div style="margin-top:8px;font-size:12px;color:#666;">';
    echo '<strong>Legendă Keez:</strong> ';
    echo '<i class="fas fa-check-circle text-success"></i> Validată (fiscal) ';
    echo '&nbsp;<i class="fas fa-clock text-warning"></i> Doar în CRM (nu push) ';
    echo '&nbsp;<i class="fas fa-times-circle text-danger"></i> Eșuat / Dead-letter ';
    echo '&nbsp;<span style="color:#aaa;">—</span> Nu a fost trimisă';
    echo '</div>';
}

/**
 * Render the "Status Keez" cell for one invoice row.
 * $status is the per-id object from /api/webhooks/whmcs/status, or null.
 */
function ots_crm_connector_keez_status_cell($status): string
{
    if (!is_array($status)) {
        return '<span style="color:#aaa;">—</span>';
    }

    $keezStatus = (string)($status['keezStatus'] ?? '');
    $syncState  = (string)($status['syncState']  ?? '');
    $invoiceNum = (string)($status['invoiceNumber'] ?? '');

    // Validated fiscal invoice — best case
    if ($keezStatus === 'Valid') {
        return '<span class="text-success" title="Validată în Keez (fiscal)">'
             . '<i class="fas fa-check-circle"></i> '
             . htmlspecialchars($invoiceNum !== '' ? $invoiceNum : 'Validată')
             . '</span>';
    }

    // Pushed to Keez but not validated yet (rare)
    if ($keezStatus === 'Draft') {
        return '<span class="text-info" title="Proformă în Keez (neactivată)">'
             . '<i class="fas fa-file-alt"></i> Proformă'
             . '</span>';
    }

    // Dead letter / failed states
    if ($syncState === 'DEAD_LETTER') {
        return '<span class="text-danger" title="Necesită review manual în CRM">'
             . '<i class="fas fa-times-circle"></i> Blocat'
             . '</span>';
    }
    if ($syncState === 'FAILED') {
        return '<span class="text-danger" title="Sincronizare eșuată în CRM">'
             . '<i class="fas fa-times-circle"></i> Eșuat'
             . '</span>';
    }

    // Pushed by Keez
    if ($syncState === 'KEEZ_PUSHED') {
        return '<span class="text-success" title="Pushed la Keez">'
             . '<i class="fas fa-check"></i> Push OK'
             . '</span>';
    }

    // Created in CRM but no Keez push yet
    if ($syncState === 'INVOICE_CREATED') {
        $label = 'În CRM';
        if ($invoiceNum !== '') $label .= ' (' . htmlspecialchars($invoiceNum) . ')';
        return '<span class="text-warning" title="Creată în CRM, încă nu pushed la Keez">'
             . '<i class="fas fa-clock"></i> ' . $label
             . '</span>';
    }

    // Pending or unknown
    if ($syncState !== '') {
        return '<span class="text-muted" title="Stare CRM: ' . htmlspecialchars($syncState) . '">'
             . '<i class="fas fa-hourglass-half"></i> ' . htmlspecialchars($syncState)
             . '</span>';
    }

    return '<span style="color:#aaa;">—</span>';
}
