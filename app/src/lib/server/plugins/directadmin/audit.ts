import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logError, serializeError } from '$lib/server/logger';

export type DaAuditAction =
	| 'suspend'
	| 'unsuspend'
	| 'create'
	| 'delete'
	| 'sync'
	| 'test'
	| 'package-change';

export type DaAuditTrigger =
	| 'hook:invoice.status.changed'
	| 'hook:invoice.paid'
	| 'manual'
	| 'cron';

export interface DaAuditEntry {
	tenantId: string;
	hostingAccountId?: string | null;
	daServerId?: string | null;
	invoiceId?: string | null;
	action: DaAuditAction;
	trigger: DaAuditTrigger;
	success: boolean;
	errorMessage?: string | null;
	durationMs?: number | null;
}

function generateAuditId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Persist a DirectAdmin operation result to the audit log table.
 * Failures inside this function are swallowed — audit should never break primary flow.
 */
export async function writeDaAudit(entry: DaAuditEntry): Promise<void> {
	try {
		await db.insert(table.daAuditLog).values({
			id: generateAuditId(),
			tenantId: entry.tenantId,
			hostingAccountId: entry.hostingAccountId ?? null,
			daServerId: entry.daServerId ?? null,
			invoiceId: entry.invoiceId ?? null,
			action: entry.action,
			trigger: entry.trigger,
			success: entry.success,
			errorMessage: entry.errorMessage ?? null,
			durationMs: entry.durationMs ?? null
		});
		if (entry.success) {
			logInfo('directadmin', `[${entry.action}] ok`, {
				tenantId: entry.tenantId,
				metadata: {
					accountId: entry.hostingAccountId,
					trigger: entry.trigger,
					durationMs: entry.durationMs
				}
			});
		} else {
			logError('directadmin', `[${entry.action}] failed: ${entry.errorMessage ?? 'unknown'}`, {
				tenantId: entry.tenantId,
				metadata: {
					accountId: entry.hostingAccountId,
					trigger: entry.trigger,
					durationMs: entry.durationMs
				}
			});
		}
	} catch (e) {
		const { message, stack } = serializeError(e);
		logError('directadmin', `audit write failed: ${message}`, { stackTrace: stack });
	}
}

/**
 * Wrap an async DA operation: time it, capture errors, persist audit row.
 * Returns the operation's result on success; rethrows on failure (after audit).
 */
export async function runWithAudit<T>(
	entry: Omit<DaAuditEntry, 'success' | 'errorMessage' | 'durationMs'>,
	op: () => Promise<T>
): Promise<T> {
	const start = Date.now();
	try {
		const result = await op();
		await writeDaAudit({
			...entry,
			success: true,
			durationMs: Date.now() - start
		});
		return result;
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		await writeDaAudit({
			...entry,
			success: false,
			errorMessage: message,
			durationMs: Date.now() - start
		});
		throw e;
	}
}

/**
 * Per-username mutex to serialize concurrent suspend/unsuspend calls against the same DA account.
 * Prevents two parallel `invoice.status.changed` hooks from racing on the same account.
 */
const accountMutexes = new Map<string, Promise<unknown>>();

export async function withAccountLock<T>(daUsername: string, op: () => Promise<T>): Promise<T> {
	const prev = accountMutexes.get(daUsername) ?? Promise.resolve();
	const next = prev.then(op, op);
	accountMutexes.set(
		daUsername,
		next.finally(() => {
			if (accountMutexes.get(daUsername) === next) accountMutexes.delete(daUsername);
		})
	);
	return next;
}
