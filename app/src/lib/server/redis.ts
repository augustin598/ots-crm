/**
 * Shared Redis client for cross-process state (rate limits, ephemeral caches).
 *
 * Reuses the same Redis instance that BullMQ already connects to via the
 * `scheduler/index.ts` queue — same host/port/password parsed from
 * `REDIS_URL`. We keep a singleton per process using a global symbol so HMR
 * restarts don't leak connections.
 *
 * `ioredis` is already in `node_modules` as a transitive of `bullmq`.
 */

import IORedis, { type Redis } from 'ioredis';
import { env } from '$env/dynamic/private';
import { logWarning, logError, serializeError } from '$lib/server/logger';

const REDIS_URL = env.REDIS_URL || 'redis://localhost:6379';

const REDIS_SINGLETON = Symbol.for('ots_shared_redis');
type Globals = { [k: symbol]: Redis | undefined };
const globalsForRedis = globalThis as unknown as Globals;

function createClient(): Redis {
	const parsed = new URL(REDIS_URL);
	const host = parsed.hostname === '0.0.0.0' ? '127.0.0.1' : parsed.hostname;
	const client = new IORedis({
		host,
		port: parseInt(parsed.port, 10) || 6379,
		password: parsed.password || undefined,
		// Same family/retry behaviour as BullMQ scheduler — Node Happy Eyeballs
		// would otherwise surface IPv4-only Redis as an opaque AggregateError.
		family: 4,
		// For one-shot commands (vs. BullMQ blocking ops), the default of 20 is
		// fine — caller can retry once if first INCR fails.
		maxRetriesPerRequest: 3,
		retryStrategy: (times: number) => Math.min(times * 200, 3000),
		lazyConnect: false
	});
	client.on('error', (err) => {
		const { message, stack } = serializeError(err);
		// Don't spam — Redis errors during outages are expected; the rate-limit
		// helper fails open and logs once per check.
		logWarning('directadmin', `shared Redis error: ${message}`, { stackTrace: stack });
	});
	return client;
}

export function getRedis(): Redis {
	if (!globalsForRedis[REDIS_SINGLETON]) {
		globalsForRedis[REDIS_SINGLETON] = createClient();
	}
	return globalsForRedis[REDIS_SINGLETON]!;
}

/**
 * Fixed-window rate limit using a single INCR + EXPIRE per request.
 *
 * Returns `{ allowed }` — when false, caller should reject. Fails OPEN on
 * Redis error so a transient Redis outage doesn't block legitimate orders
 * (an attacker exploiting the open window is a smaller risk than blocking
 * all paying customers).
 *
 * Key shape: `rl:<kind>:<ip>:<bucket>` where `bucket = Math.floor(now / windowMs)`.
 * TTL = windowSec * 2 so we don't lose count across the bucket boundary.
 */
export async function rateLimit(opts: {
	kind: string;
	ip: string;
	limit: number;
	windowSec: number;
}): Promise<{ allowed: boolean; count: number; limit: number }> {
	const { kind, ip, limit, windowSec } = opts;
	const bucket = Math.floor(Date.now() / 1000 / windowSec);
	const key = `rl:${kind}:${ip}:${bucket}`;
	try {
		const client = getRedis();
		const count = await client.incr(key);
		if (count === 1) {
			// First hit in this window — set TTL so we don't accumulate forever.
			await client.expire(key, windowSec * 2);
		}
		return { allowed: count <= limit, count, limit };
	} catch (err) {
		const { message } = serializeError(err);
		logError('directadmin', `rate-limit Redis failed (fail-open): ${message}`, {
			metadata: { kind, ip: ip.slice(0, 32), limit, windowSec }
		});
		return { allowed: true, count: 0, limit };
	}
}
