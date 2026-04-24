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
}

export function _inspectQueueForTests(tenantId: string): TenantQueue {
	return getQueue(tenantId);
}
