type TenantQueue = {
	pending: string[]; // phoneE164 in FIFO order
	inFlight: Set<string>;
	workerRunning: boolean;
};

const SYMBOL = Symbol.for('ots_crm_whatsapp_avatar_queues');
const GT = globalThis as unknown as Record<symbol, unknown>;
const queues: Map<string, TenantQueue> =
	(GT[SYMBOL] as Map<string, TenantQueue>) ??
	(GT[SYMBOL] = new Map<string, TenantQueue>());

function getQueue(tenantId: string): TenantQueue {
	let q = queues.get(tenantId);
	if (!q) {
		q = { pending: [], inFlight: new Set(), workerRunning: false };
		queues.set(tenantId, q);
	}
	return q;
}

type RateState = { tokens: number; intervalMs: number; lastRefillAt: number };

const GLOBAL_RATE: RateState = {
	tokens: 1,
	intervalMs: 1000, // 1 req/s across all tenants
	lastRefillAt: Date.now()
};

async function acquireGlobalToken(): Promise<void> {
	// Refill up to 1 token
	const now = Date.now();
	const elapsed = now - GLOBAL_RATE.lastRefillAt;
	if (elapsed >= GLOBAL_RATE.intervalMs) {
		GLOBAL_RATE.tokens = 1;
		GLOBAL_RATE.lastRefillAt = now;
	}
	if (GLOBAL_RATE.tokens > 0) {
		GLOBAL_RATE.tokens -= 1;
		return;
	}
	const wait = GLOBAL_RATE.intervalMs - elapsed;
	await new Promise((resolve) => setTimeout(resolve, wait));
	GLOBAL_RATE.tokens = 0;
	GLOBAL_RATE.lastRefillAt = Date.now();
}

// Test helpers (not exported from index)
export async function _acquireGlobalTokenForTests(): Promise<void> {
	await acquireGlobalToken();
}

export function _setGlobalRateForTests(opts: { intervalMs: number; initialTokens: number }): void {
	GLOBAL_RATE.tokens = opts.initialTokens;
	GLOBAL_RATE.intervalMs = opts.intervalMs;
	GLOBAL_RATE.lastRefillAt = Date.now();
}

export interface EnqueueOptions {
	/** For tests — skip spinning up the worker loop. */
	skipWorker?: boolean;
}

export function enqueueFetch(
	tenantId: string,
	phoneE164: string,
	opts: EnqueueOptions = {}
): void {
	const q = getQueue(tenantId);
	if (q.inFlight.has(phoneE164)) return;
	if (q.pending.includes(phoneE164)) return;
	q.pending.push(phoneE164);
	if (!opts.skipWorker) void ensureWorkerRunning(tenantId);
}

export function dropTenant(tenantId: string): void {
	const q = queues.get(tenantId);
	if (!q) return;
	q.pending.length = 0;
	q.inFlight.clear();
	// worker loop sees empty queue next tick and exits
}

async function ensureWorkerRunning(_tenantId: string): Promise<void> {
	// Implemented in Task 4 — this stub keeps the type signature stable.
}

// Test helpers (not exported from index)
export function _resetAvatarFetcherForTests(): void {
	queues.clear();
	GLOBAL_RATE.tokens = 1;
	GLOBAL_RATE.intervalMs = 1000;
	GLOBAL_RATE.lastRefillAt = Date.now();
}

export function _inspectQueueForTests(tenantId: string): TenantQueue {
	return getQueue(tenantId);
}
