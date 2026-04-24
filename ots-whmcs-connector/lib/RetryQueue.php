<?php
/**
 * Retry queue for webhooks that failed transiently (network / 5xx).
 *
 * Table name: `mod_otscrm_retry_queue`. We use WHMCS's Capsule DB layer so
 * this works on any WHMCS-supported DB backend without raw SQL surprises.
 *
 * Columns:
 *   id             int PK AUTO_INCREMENT
 *   event_type     varchar(40)   — 'invoices' | 'clients' | 'products' | 'transactions'
 *   path           varchar(255)  — full URL path used on the CRM
 *   body           longtext      — the JSON body exactly as signed
 *   attempts       int           — number of send attempts so far
 *   last_status    int           — last HTTP response code (0 if network error)
 *   last_error     text          — truncated response body from the last failure
 *   status         varchar(10)   — 'pending' | 'sent' | 'failed'
 *   created_at     datetime      — when first enqueued
 *   last_try_at    datetime NULL — when last attempted
 *
 * Cron flow (WHMCS DailyCronJob + AdminAreaPage invoke Api::flushRetryQueue):
 *   - Process up to 50 pending rows, sending each.
 *   - 2xx → mark 'sent'.
 *   - 5xx/network → bump attempts (still 'pending').
 *   - 4xx → mark 'failed' (permanent).
 */

namespace OtsCrm;

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

use Illuminate\Database\Capsule\Manager as Capsule;

class RetryQueue
{
    private const TABLE = 'mod_otscrm_retry_queue';

    /**
     * Idempotent — safe to call on every module activation.
     */
    public static function install(): void
    {
        if (Capsule::schema()->hasTable(self::TABLE)) {
            return;
        }
        Capsule::schema()->create(self::TABLE, function ($table) {
            $table->bigIncrements('id');
            $table->string('event_type', 40);
            $table->string('path', 255);
            $table->longText('body');
            $table->unsignedInteger('attempts')->default(0);
            $table->integer('last_status')->default(0);
            $table->text('last_error')->nullable();
            $table->string('status', 10)->default('pending');
            $table->dateTime('created_at')->useCurrent();
            $table->dateTime('last_try_at')->nullable();
            $table->index(['status', 'created_at']);
        });
    }

    public static function enqueue(string $eventType, string $path, string $body): int
    {
        return (int)Capsule::table(self::TABLE)->insertGetId([
            'event_type' => $eventType,
            'path'       => $path,
            'body'       => $body,
            'attempts'   => 0,
            'last_status'=> 0,
            'status'     => 'pending',
            'created_at' => date('Y-m-d H:i:s'),
        ]);
    }

    /** Fetch up to $limit pending jobs ordered oldest-first. */
    public static function pending(int $limit = 50): array
    {
        return Capsule::table(self::TABLE)
            ->where('status', 'pending')
            ->orderBy('created_at', 'asc')
            ->limit($limit)
            ->get()
            ->toArray();
    }

    public static function markSent(int $id): void
    {
        Capsule::table(self::TABLE)
            ->where('id', $id)
            ->update([
                'status'      => 'sent',
                'last_try_at' => date('Y-m-d H:i:s'),
                'last_error'  => null,
            ]);
    }

    public static function markFailed(int $id, int $status, string $body): void
    {
        Capsule::table(self::TABLE)
            ->where('id', $id)
            ->update([
                'status'      => 'failed',
                'last_status' => $status,
                'last_error'  => mb_substr($body, 0, 2000),
                'last_try_at' => date('Y-m-d H:i:s'),
            ]);
    }

    public static function bumpAttempts(int $id): void
    {
        Capsule::table(self::TABLE)
            ->where('id', $id)
            ->update([
                'attempts'    => Capsule::raw('attempts + 1'),
                'last_try_at' => date('Y-m-d H:i:s'),
            ]);
    }

    public static function stats(): array
    {
        if (!Capsule::schema()->hasTable(self::TABLE)) {
            return ['pending' => 0, 'failed' => 0, 'total' => 0];
        }
        $rows = Capsule::table(self::TABLE)
            ->select('status', Capsule::raw('count(*) as c'))
            ->groupBy('status')
            ->get();

        $pending = 0;
        $failed  = 0;
        $total   = 0;
        foreach ($rows as $r) {
            $c = (int)$r->c;
            $total += $c;
            if ($r->status === 'pending') $pending = $c;
            if ($r->status === 'failed')  $failed  = $c;
        }
        return ['pending' => $pending, 'failed' => $failed, 'total' => $total];
    }
}
