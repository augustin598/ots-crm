<?php
/**
 * HTTP client for WHMCS → OTS CRM webhooks.
 *
 * Responsibilities:
 *   - Build HMAC-signed headers (via \OtsCrm\Hmac)
 *   - POST JSON body to the CRM webhook path
 *   - Classify outcomes:
 *       2xx            → delivered
 *       4xx (400, 401) → permanent failure (log + drop, do not retry)
 *       5xx, timeout   → transient → push into retry queue for cron replay
 *   - Expose dry-run mode (logActivity instead of HTTP)
 *   - Test-connection probe hits /health (GET with empty body)
 */

namespace OtsCrm;

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

class Api
{
    /**
     * Send a POST webhook to the CRM.
     *
     * $eventType informs the endpoint path (invoices|clients|products|transactions).
     * $payloadKey is stored alongside retried jobs so operators can dedupe.
     *
     * Returns true on 2xx. False + queue insert on transient failure.
     * False without queue insert on permanent 4xx (logged).
     */
    public static function send(array $settings, string $eventType, array $payload): bool
    {
        $dryRun = (($settings['dryRun'] ?? 'no') === 'on' || ($settings['dryRun'] ?? '') === 'yes');
        $body   = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($body === false) {
            logActivity('OTS CRM: JSON encode failed for ' . $eventType);
            return false;
        }

        if ($dryRun) {
            logActivity('OTS CRM [DRY-RUN] ' . $eventType . ' → ' . substr($body, 0, 200));
            return true;
        }

        $path = self::buildPath($settings, $eventType);
        $url  = rtrim((string)$settings['crmBaseUrl'], '/') . $path;

        $headers = Hmac::buildHeaders(
            (string)$settings['sharedSecret'],
            'POST',
            $path,
            (string)$settings['tenantSlug'],
            $body
        );

        $result = self::httpPost($url, $headers, $body, self::timeout($settings));

        if ($result['ok']) {
            return true;
        }

        // Classify
        $status = (int)($result['status'] ?? 0);
        $transient = $status === 0 /* network/timeout */ || ($status >= 500 && $status < 600);

        if ($transient) {
            RetryQueue::enqueue($eventType, $path, $body);
            logActivity(sprintf(
                'OTS CRM: transient failure (%s, status=%d), queued for retry',
                $eventType,
                $status
            ));
        } else {
            logActivity(sprintf(
                'OTS CRM: permanent failure (%s, status=%d, body=%s) — DROPPED',
                $eventType,
                $status,
                substr((string)($result['responseBody'] ?? ''), 0, 500)
            ));
        }
        return false;
    }

    /**
     * GET /health to validate configuration. Returns a structured outcome for
     * the admin UI. Never throws.
     */
    public static function testConnection(array $settings): array
    {
        $path = self::buildPath($settings, 'health');
        $url  = rtrim((string)$settings['crmBaseUrl'], '/') . $path;

        // GET has empty body; HMAC canonical still includes ""
        $headers = Hmac::buildHeaders(
            (string)$settings['sharedSecret'],
            'GET',
            $path,
            (string)$settings['tenantSlug'],
            ''
        );

        $result = self::httpGet($url, $headers, self::timeout($settings));

        if (!$result['ok']) {
            $decoded = json_decode((string)($result['responseBody'] ?? ''), true);
            return [
                'ok'         => false,
                'httpStatus' => (int)($result['status'] ?? 0),
                'reason'     => is_array($decoded) ? ($decoded['reason'] ?? 'http_error') : 'network_error',
            ];
        }

        $decoded = json_decode((string)$result['responseBody'], true);
        if (!is_array($decoded) || ($decoded['ok'] ?? false) !== true) {
            return [
                'ok'     => false,
                'reason' => 'invalid_response',
            ];
        }

        return [
            'ok'               => true,
            'tenantSlug'       => (string)($decoded['tenantSlug'] ?? ''),
            'connectorVersion' => (string)($decoded['connectorVersion'] ?? ''),
            'dryRun'           => (bool)($decoded['dryRun'] ?? false),
            'receivedAt'       => (int)($decoded['receivedAt'] ?? 0),
        ];
    }

    /**
     * Drain the retry queue. Called from the admin UI button and from the
     * WHMCS daily cron (see hooks.php).
     */
    public static function flushRetryQueue(array $settings): array
    {
        $dryRun = (($settings['dryRun'] ?? '') === 'on' || ($settings['dryRun'] ?? '') === 'yes');
        if ($dryRun) {
            return ['sent' => 0, 'stillPending' => RetryQueue::stats()['pending'], 'failed' => 0];
        }

        $sent = 0;
        $failed = 0;

        foreach (RetryQueue::pending(50) as $job) {
            $url = rtrim((string)$settings['crmBaseUrl'], '/') . $job['path'];
            $headers = Hmac::buildHeaders(
                (string)$settings['sharedSecret'],
                'POST',
                $job['path'],
                (string)$settings['tenantSlug'],
                $job['body']
            );
            $result = self::httpPost($url, $headers, $job['body'], self::timeout($settings));

            if ($result['ok']) {
                RetryQueue::markSent((int)$job['id']);
                $sent++;
            } else {
                $status = (int)($result['status'] ?? 0);
                // Permanent 4xx → give up. Transient → bump attempts and keep.
                $transient = $status === 0 || ($status >= 500 && $status < 600);
                if (!$transient) {
                    RetryQueue::markFailed((int)$job['id'], $status, (string)($result['responseBody'] ?? ''));
                    $failed++;
                } else {
                    RetryQueue::bumpAttempts((int)$job['id']);
                }
            }
        }

        $stats = RetryQueue::stats();
        return ['sent' => $sent, 'stillPending' => (int)$stats['pending'], 'failed' => $failed];
    }

    // ─── internals ──────────────────────────────────────────────────────

    private static function buildPath(array $settings, string $eventType): string
    {
        $slug = trim((string)$settings['tenantSlug'], '/ ');
        return '/' . $slug . '/api/webhooks/whmcs/' . $eventType;
    }

    private static function timeout(array $settings): int
    {
        $t = (int)($settings['timeoutSec'] ?? 15);
        return ($t > 0 && $t < 120) ? $t : 15;
    }

    private static function httpPost(string $url, array $headers, string $body, int $timeoutSec): array
    {
        return self::httpRequest('POST', $url, $headers, $body, $timeoutSec);
    }

    private static function httpGet(string $url, array $headers, int $timeoutSec): array
    {
        return self::httpRequest('GET', $url, $headers, null, $timeoutSec);
    }

    /**
     * Thin cURL wrapper. Does NOT throw — always returns a structured result.
     * Uses TLS verification (defaults on). Never follows redirects (a WHMCS
     * webhook should never be redirected; a 30x is a misconfiguration bug).
     */
    private static function httpRequest(string $method, string $url, array $headers, ?string $body, int $timeoutSec): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeoutSec,
            CURLOPT_CONNECTTIMEOUT => min($timeoutSec, 10),
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_USERAGENT      => 'ots-crm-connector/1.0 (WHMCS)',
        ]);
        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body ?? '');
        }

        $responseBody = curl_exec($ch);
        $errno   = curl_errno($ch);
        $errstr  = curl_error($ch);
        $status  = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($errno !== 0) {
            return ['ok' => false, 'status' => 0, 'error' => $errstr, 'responseBody' => ''];
        }

        return [
            'ok'           => $status >= 200 && $status < 300,
            'status'       => $status,
            'responseBody' => (string)$responseBody,
        ];
    }
}
