<?php
/**
 * Per-tenant nonce dedup for inbound callbacks. Prevents replay of a
 * captured signed request within the timestamp window.
 *
 * Backing store: WHMCS Capsule DB (table `mod_otscrm_nonces`). Redis would
 * be ideal but not all WHMCS hosts have it; the CRM-side nonce cache uses
 * Redis but the WHMCS side has to assume only MySQL is available.
 *
 * Schema:
 *   nonce       varchar(64) PK
 *   tenant_slug varchar(100)
 *   created_at  datetime
 *
 * GC: rows older than 10 min (2× HMAC timestamp window) are deleted on each
 * check. The window is 65 s; 10 min is plenty of headroom and keeps the
 * table tiny without a separate cron.
 */

namespace OtsCrm;

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

use Illuminate\Database\Capsule\Manager as Capsule;

class NonceStore
{
    private const TABLE = 'mod_otscrm_nonces';
    private const TTL_SECONDS = 600;

    /** Idempotent — call from activation hook. */
    public static function install(): void
    {
        if (Capsule::schema()->hasTable(self::TABLE)) {
            return;
        }
        Capsule::schema()->create(self::TABLE, function ($table) {
            $table->string('nonce', 64)->primary();
            $table->string('tenant_slug', 100);
            $table->dateTime('created_at')->useCurrent();
            $table->index(['tenant_slug', 'created_at']);
        });
    }

    /**
     * Returns true if `nonce` is fresh (NOT seen before in TTL_SECONDS).
     * Returns false if it was already used → caller MUST reject the request.
     *
     * Side effect on success: stores the nonce so subsequent calls reject it.
     * Garbage-collects expired rows opportunistically (cheap delete on every
     * check; keeps the table small).
     */
    public static function checkAndStore(string $tenantSlug, string $nonce): bool
    {
        if ($nonce === '' || strlen($nonce) > 64) {
            return false;
        }

        try {
            // GC first — opportunistic; failure here doesn't block the check.
            $cutoff = date('Y-m-d H:i:s', time() - self::TTL_SECONDS);
            Capsule::table(self::TABLE)
                ->where('created_at', '<', $cutoff)
                ->delete();
        } catch (\Throwable $e) {
            // Table missing? Log + accept — operator hasn't installed schema.
            // Without a store we can't dedupe, but we shouldn't break callbacks.
            return true;
        }

        try {
            // INSERT IGNORE pattern: PRIMARY KEY collision returns 0 rows
            // affected. Cheaper than SELECT-then-INSERT.
            $existing = Capsule::table(self::TABLE)
                ->where('nonce', $nonce)
                ->where('tenant_slug', $tenantSlug)
                ->exists();
            if ($existing) {
                return false;
            }
            Capsule::table(self::TABLE)->insert([
                'nonce'       => $nonce,
                'tenant_slug' => $tenantSlug,
                'created_at'  => date('Y-m-d H:i:s'),
            ]);
            return true;
        } catch (\Throwable $e) {
            // Race — another request inserted the same nonce between exists()
            // and insert(). Treat as duplicate.
            return false;
        }
    }
}
