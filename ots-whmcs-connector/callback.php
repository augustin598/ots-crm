<?php
/**
 * OTS CRM → WHMCS callback: accept an updated invoice number from the CRM.
 *
 * Flow:
 *   WHMCS creates invoice with its own number (e.g. OTS567)
 *   → connector sends webhook to CRM
 *   → CRM creates invoice with fiscal series number (e.g. "HOST 568")
 *   → CRM pushes to Keez (optional, if enabled)
 *   → CRM calls THIS endpoint with the final fiscal number
 *   → we UPDATE tblinvoices.invoicenum so client-facing artifacts (PDF,
 *     emails, client portal) reflect the Keez-validated number.
 *
 * Auth: HMAC-SHA256 over the canonical payload. Same shared secret used
 * for the inbound webhook. No WHMCS session is involved — this endpoint
 * must work without an admin logged in, since it's server-to-server.
 *
 * Path: /modules/addons/ots_crm_connector/callback.php
 *
 * Canonical payload (MUST match app/src/lib/server/whmcs/hmac.ts):
 *   `${timestamp}\n${METHOD}\n${urlPath}\n${tenantSlug}\n${nonce}\n${body}`
 *
 * Request:
 *   POST /modules/addons/ots_crm_connector/callback.php
 *   Headers: X-OTS-Timestamp, X-OTS-Signature, X-OTS-Tenant, X-OTS-Nonce
 *   Body: { "whmcsInvoiceId": 97, "invoiceNumber": "HOST 568" }
 *
 * Response:
 *   200 OK  { "ok": true,  "whmcsInvoiceId": 97, "oldNumber": "OTS567", "newNumber": "HOST 568" }
 *   4xx     { "ok": false, "reason": "..." }  — see reason codes inline
 */

// Bootstrap WHMCS so we have Capsule + logActivity available.
// dirname(__FILE__) → /.../modules/addons/ots_crm_connector
// We need /.../init.php at the WHMCS root: 3 levels up.
define('CLIENTAREA', true);

$initPath = dirname(__FILE__, 4) . '/init.php';
if (!file_exists($initPath)) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'reason' => 'whmcs_init_missing']);
    exit;
}
require_once $initPath;

use Illuminate\Database\Capsule\Manager as Capsule;

require_once __DIR__ . '/lib/Hmac.php';

header('Content-Type: application/json');

function ots_callback_respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

// ── Collect request ─────────────────────────────────────────────────────
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'POST') {
    ots_callback_respond(405, ['ok' => false, 'reason' => 'method_not_allowed']);
}

$rawBody = file_get_contents('php://input');
if ($rawBody === false) {
    $rawBody = '';
}

$ts    = $_SERVER['HTTP_X_OTS_TIMESTAMP'] ?? '';
$sig   = $_SERVER['HTTP_X_OTS_SIGNATURE'] ?? '';
$slug  = $_SERVER['HTTP_X_OTS_TENANT']    ?? '';
$nonce = $_SERVER['HTTP_X_OTS_NONCE']     ?? '';

if ($ts === '' || $sig === '' || $slug === '' || $nonce === '') {
    ots_callback_respond(401, ['ok' => false, 'reason' => 'missing_signature_headers']);
}

$tsInt = (int)$ts;
if ($tsInt <= 0) {
    ots_callback_respond(401, ['ok' => false, 'reason' => 'invalid_timestamp']);
}

// ±65 s window — matches TIMESTAMP_WINDOW_SECONDS on the TS side.
$drift = abs(time() - $tsInt);
if ($drift > 65) {
    ots_callback_respond(401, ['ok' => false, 'reason' => 'stale_timestamp']);
}

// ── Load addon settings + tenant + shared secret ────────────────────────
try {
    $rows = Capsule::table('tbladdonmodules')
        ->where('module', 'ots_crm_connector')
        ->get();
} catch (\Throwable $e) {
    ots_callback_respond(500, ['ok' => false, 'reason' => 'db_unavailable']);
}

$settings = [];
foreach ($rows as $row) {
    $settings[$row->setting] = $row->value;
}

$storedSecret = (string)($settings['sharedSecret'] ?? '');
$storedSlug   = trim((string)($settings['tenantSlug'] ?? ''));

if ($storedSecret === '' || $storedSlug === '') {
    ots_callback_respond(500, ['ok' => false, 'reason' => 'addon_not_configured']);
}

if ($slug !== $storedSlug) {
    ots_callback_respond(401, ['ok' => false, 'reason' => 'tenant_slug_mismatch']);
}

// ── Verify HMAC ─────────────────────────────────────────────────────────
$path = '/modules/addons/ots_crm_connector/callback.php';
// Some hosting setups put WHMCS in a subdirectory (e.g. /host/modules/…).
// Accept the request if the calculated path matches either the bare module
// path or the REQUEST_URI. The CRM signs with `new URL(DEFAULT_CALLBACK_PATH,
// integration.whmcsUrl).pathname`, so if whmcsUrl=https://host/host/ the
// pathname is /host/modules/addons/ots_crm_connector/callback.php.
$requestPath = $_SERVER['REQUEST_URI'] ?? $path;
// Strip query string if present
$requestPathClean = strtok($requestPath, '?');

$verified = false;
foreach ([$path, $requestPathClean] as $candidatePath) {
    if (\OtsCrm\Hmac::sign(
        $storedSecret,
        $tsInt,
        'POST',
        (string)$candidatePath,
        $slug,
        $nonce,
        $rawBody
    ) === $sig) {
        $verified = true;
        break;
    }
    // Constant-time compare
    if (hash_equals(
        \OtsCrm\Hmac::sign($storedSecret, $tsInt, 'POST', (string)$candidatePath, $slug, $nonce, $rawBody),
        (string)$sig
    )) {
        $verified = true;
        break;
    }
}

if (!$verified) {
    ots_callback_respond(401, ['ok' => false, 'reason' => 'signature_mismatch']);
}

// ── Parse + validate payload ────────────────────────────────────────────
$payload = json_decode($rawBody, true);
if (!is_array($payload)) {
    ots_callback_respond(400, ['ok' => false, 'reason' => 'invalid_json']);
}

$whmcsInvoiceId = (int)($payload['whmcsInvoiceId'] ?? 0);
$newNumber      = trim((string)($payload['invoiceNumber'] ?? ''));

if ($whmcsInvoiceId <= 0) {
    ots_callback_respond(400, ['ok' => false, 'reason' => 'missing_whmcsInvoiceId']);
}
if ($newNumber === '') {
    ots_callback_respond(400, ['ok' => false, 'reason' => 'missing_invoiceNumber']);
}

// ── Load invoice + update ───────────────────────────────────────────────
try {
    $existing = Capsule::table('tblinvoices')
        ->where('id', $whmcsInvoiceId)
        ->first();
} catch (\Throwable $e) {
    ots_callback_respond(500, ['ok' => false, 'reason' => 'db_unavailable']);
}

if (!$existing) {
    ots_callback_respond(404, ['ok' => false, 'reason' => 'invoice_not_found']);
}

$oldNumber = (string)($existing->invoicenum ?? '');
if ($oldNumber === $newNumber) {
    // Idempotent — second call with same number is a no-op.
    ots_callback_respond(200, [
        'ok'             => true,
        'noop'           => true,
        'whmcsInvoiceId' => $whmcsInvoiceId,
        'oldNumber'      => $oldNumber,
        'newNumber'      => $newNumber,
    ]);
}

try {
    Capsule::table('tblinvoices')
        ->where('id', $whmcsInvoiceId)
        ->update(['invoicenum' => $newNumber]);
} catch (\Throwable $e) {
    ots_callback_respond(500, ['ok' => false, 'reason' => 'db_update_failed', 'detail' => $e->getMessage()]);
}

if (function_exists('logActivity')) {
    logActivity(sprintf(
        'OTS CRM: Updated invoice #%d number from "%s" to "%s" (via callback)',
        $whmcsInvoiceId,
        $oldNumber,
        $newNumber
    ));
}

ots_callback_respond(200, [
    'ok'             => true,
    'whmcsInvoiceId' => $whmcsInvoiceId,
    'oldNumber'      => $oldNumber,
    'newNumber'      => $newNumber,
]);
