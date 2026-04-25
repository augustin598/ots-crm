<?php
/**
 * HMAC signing for WHMCS → OTS CRM webhooks.
 *
 * The canonical payload MUST match the TypeScript side byte-for-byte,
 * otherwise every signature fails. Mirror of:
 *   app/src/lib/server/whmcs/hmac.ts → canonicalPayload(...)
 *
 * Canonical format:
 *   `${timestamp}\n${METHOD}\n${path}\n${tenantSlug}\n${nonce}\n${body}`
 *
 * Fields BAKED into the signature (not just routed via headers):
 *   - tenantSlug → prevents cross-tenant replay via header swap
 *   - nonce      → 5-min anti-replay in the CRM's Redis nonce cache
 *
 * Tested against 24 unit tests on the TS side incl. cross-tenant replay.
 */

namespace OtsCrm;

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

class Hmac
{
    /**
     * Build the canonical payload string that will be HMAC-signed. Kept as a
     * private helper so sign/verify stays in sync — single source of truth.
     *
     * @param int    $timestamp   Unix seconds
     * @param string $method      HTTP method (case-insensitive; normalized to upper)
     * @param string $path        URL path part (e.g. "/ots/api/webhooks/whmcs/invoices")
     * @param string $tenantSlug  CRM tenant slug (e.g. "ots")
     * @param string $nonce       UUID per request
     * @param string $body        Raw request body (empty string for GET)
     */
    private static function canonicalPayload(
        int $timestamp,
        string $method,
        string $path,
        string $tenantSlug,
        string $nonce,
        string $body
    ): string {
        return $timestamp
            . "\n" . strtoupper($method)
            . "\n" . $path
            . "\n" . $tenantSlug
            . "\n" . $nonce
            . "\n" . $body;
    }

    /**
     * Compute HMAC-SHA256 signature (hex-encoded, 64 chars).
     */
    public static function sign(
        string $secret,
        int $timestamp,
        string $method,
        string $path,
        string $tenantSlug,
        string $nonce,
        string $body
    ): string {
        $canonical = self::canonicalPayload(
            $timestamp,
            $method,
            $path,
            $tenantSlug,
            $nonce,
            $body
        );
        return hash_hmac('sha256', $canonical, $secret);
    }

    /**
     * Build the full headers array the CRM expects.
     *
     * Returns:
     *   Content-Type, X-OTS-Timestamp, X-OTS-Signature, X-OTS-Tenant, X-OTS-Nonce
     */
    public static function buildHeaders(
        string $secret,
        string $method,
        string $path,
        string $tenantSlug,
        string $body
    ): array {
        $timestamp = time();
        $nonce     = self::uuid4();
        $signature = self::sign($secret, $timestamp, $method, $path, $tenantSlug, $nonce, $body);

        return [
            'Content-Type: application/json',
            'X-OTS-Timestamp: ' . $timestamp,
            'X-OTS-Signature: ' . $signature,
            'X-OTS-Tenant: '    . $tenantSlug,
            'X-OTS-Nonce: '     . $nonce,
        ];
    }

    /**
     * RFC 4122 v4 UUID using random_bytes. Matches the TS side's
     * `crypto.randomUUID()` output shape (lowercase hex with dashes).
     */
    public static function uuid4(): string
    {
        $bytes = random_bytes(16);
        // Set version to 0100 (v4)
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        // Set bits 6-7 of clock_seq_hi to 10
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        return vsprintf(
            '%s%s-%s-%s-%s-%s%s%s',
            str_split(bin2hex($bytes), 4)
        );
    }
}
